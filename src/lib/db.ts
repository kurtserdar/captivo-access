import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { currentTx } from "@/lib/tenant/context";

// Prisma 7: schema.prisma no longer carries a datasource url — the client's
// runtime connection is set up via a driver adapter (see prisma.config.ts comment).
// Multi-tenant cloud connects as the non-owner `app` role (RLS applies) via
// APP_DATABASE_URL; self-host connects as the owner (RLS bypassed) via DATABASE_URL.
const connectionString = multiTenantEnabled()
  ? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL
  : process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });

// Cache the physical client across HMR (dev) to avoid connection storms.
const globalForPrisma = globalThis as unknown as { prismaBase?: PrismaClient };
// The plain client (owner in self-host; app role in cloud). scope.ts opens the
// request transaction on it so the tenant GUC lands on that connection.
export const base = globalForPrisma.prismaBase ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = base;

// Tenant enforcement is entirely in the database (validated deterministic):
//   - reads: RLS policies scope to current_setting('app.current_tenant')
//   - writes: a BEFORE INSERT trigger stamps tenantId from the same GUC
// Both are connection-bound (the GUC set on the request tx), so there is no
// dependency on AsyncLocalStorage inside Prisma's query pipeline. `db` only has
// to route every op onto the request tx whose connection carries the GUC.

// When inside a withTenant scope, `db.$transaction` must reuse the ambient
// request transaction (whose connection carries the GUC) rather than open a new,
// GUC-less one.
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
// connection under RLS. Receiver MUST be the tx (not the proxy) so Prisma's
// model-delegate getters bind to the tx connection. Outside a scope it hits the
// base app-role client with no GUC → RLS returns nothing (fail-closed).
function makeTenantDb(): PrismaClient {
  return new Proxy(base, {
    get(target, prop) {
      const tx = currentTx() as TxClient | null;
      if (prop === "$transaction") {
        return tx ? txAwareTransaction(tx, target) : Reflect.get(target, prop, target);
      }
      if (tx && prop in tx) return Reflect.get(tx, prop, tx);
      return Reflect.get(target, prop, target);
    },
  }) as unknown as PrismaClient;
}

// Self-host (flag off): `db === base` (owner, no proxy/tx/GUC — RLS inert).
// Cloud (flag on): the tenant-routing proxy.
export const db = multiTenantEnabled() ? makeTenantDb() : base;
