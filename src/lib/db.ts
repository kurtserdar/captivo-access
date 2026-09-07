import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { fillTenant, whereTenant, currentTx } from "@/lib/tenant/context";

// Prisma 7: schema.prisma no longer carries a datasource url — the client's
// runtime connection is set up via a driver adapter (see prisma.config.ts comment).
// Multi-tenant cloud connects as the non-owner `app` role (RLS applies) via
// APP_DATABASE_URL; self-host connects as the owner (RLS bypassed) via DATABASE_URL.
const connectionString = multiTenantEnabled()
  ? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL
  : process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });

// Fills tenantId into a create/upsert payload from the active tenant, and scopes
// filterable reads/mutations by tenantId, at the ORM layer. Only meaningful when
// MULTI_TENANT is on (self-host uses the plain client). Belt-and-suspenders with
// the DB RLS policies.
function withTenantInjection(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        create({ args, query }) {
          args.data = fillTenant(args.data);
          return query(args);
        },
        createMany({ args, query }) {
          args.data = (Array.isArray(args.data) ? args.data.map(fillTenant) : fillTenant(args.data)) as typeof args.data;
          return query(args);
        },
        upsert({ args, query }) {
          args.create = fillTenant(args.create);
          return query(args);
        },
        // findUnique/update/delete by a unique key are not filterable here; the DB
        // RLS policies (active under the app role + GUC) close that gap.
        findMany({ args, query }) { return query(whereTenant(args)); },
        findFirst({ args, query }) { return query(whereTenant(args)); },
        findFirstOrThrow({ args, query }) { return query(whereTenant(args)); },
        count({ args, query }) { return query(whereTenant(args)); },
        aggregate({ args, query }) { return query(whereTenant(args)); },
        groupBy({ args, query }) { return query(whereTenant(args)); },
        updateMany({ args, query }) { return query(whereTenant(args)); },
        deleteMany({ args, query }) { return query(whereTenant(args)); },
      },
    },
  }) as unknown as PrismaClient;
}

// Cache the physical client across HMR (dev) to avoid connection storms.
const globalForPrisma = globalThis as unknown as { prismaBase?: PrismaClient };
// The plain client (owner in self-host; app role in cloud). scope.ts opens the
// request transaction on `ext` (below) so the tenant GUC is set on its connection.
export const base = globalForPrisma.prismaBase ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = base;

// The tenant-scoping extended client.
export const ext = withTenantInjection(base);

// When inside a withTenant scope, `db.$transaction` must reuse the ambient
// request transaction (whose connection carries the GUC) rather than open a new,
// GUC-less one — otherwise nested transactions in existing call sites would see
// no tenant context and RLS would return nothing.
type TxClient = { [k: string]: unknown };
function txAwareTransaction(ambientTx: TxClient, target: PrismaClient) {
  return (arg: unknown, opts?: unknown): unknown => {
    if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(ambientTx); // interactive: reuse
    if (Array.isArray(arg)) return Promise.all(arg); // batch: elements already bound to the ambient tx via the proxy
    return (target.$transaction as (a: unknown, o?: unknown) => unknown)(arg, opts);
  };
}

// Multi-tenant db: a proxy that routes every operation onto the ambient request
// transaction (from ALS) when one is set, so queries run on the GUC-carrying
// connection under RLS. Outside a scope it hits `ext` with no GUC → RLS returns
// nothing (fail-closed).
function makeTenantDb(): PrismaClient {
  return new Proxy(ext, {
    get(target, prop, recv) {
      const tx = currentTx() as TxClient | null;
      if (prop === "$transaction") {
        return tx ? txAwareTransaction(tx, target) : Reflect.get(target, prop, recv);
      }
      if (tx && prop in tx) return Reflect.get(tx, prop, recv);
      return Reflect.get(target, prop, recv);
    },
  }) as unknown as PrismaClient;
}

// Self-host (flag off): `db === base` (owner, no proxy/tx/GUC — RLS inert).
// Cloud (flag on): the tenant-routing proxy.
export const db = multiTenantEnabled() ? makeTenantDb() : base;
