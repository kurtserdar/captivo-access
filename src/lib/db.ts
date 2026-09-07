import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { currentTx } from "@/lib/tenant/context";
import { resolveAmbientRequestTenant } from "@/lib/tenant/ambient";

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

// Run `op(tx)` in a fresh transaction whose connection carries the request
// tenant's GUC (per-op auto-scope for unwrapped cloud request contexts). Used
// only on the no-ambient-tx path — a request handler that forgot to wrap
// itself in withTenant(Route)/withRequestTenant. Resolves the tenant from the
// request host (see ambient.ts); throws TenantScopeRequiredError when there is
// no request context or the host doesn't map to a tenant, so an unwrapped op
// fails fast instead of silently hitting RLS with no GUC.
async function inAutoScope<T>(op: (tx: TxClient) => Promise<T>): Promise<T> {
  const tid = await resolveAmbientRequestTenant();
  return base.$transaction(async (tx) => {
    await (tx as unknown as { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> })
      .$executeRaw`SELECT set_config('app.current_tenant', ${tid}, true)`;
    return op(tx as unknown as TxClient);
  });
}

const RAW = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);

// Multi-tenant db: a proxy that routes every operation onto the ambient request
// transaction (from ALS) when one is set, so queries run on the GUC-carrying
// connection under RLS. Receiver MUST be the tx (not the proxy) so Prisma's
// model-delegate getters bind to the tx connection. Outside a scope (no ambient
// tx), auto-scope: resolve the request tenant from the host and run the op
// inside a per-op GUC-set mini-transaction (inAutoScope) — covers model
// delegates, $transaction, and raw methods. A non-request context (no
// resolvable host) fails fast with TenantScopeRequiredError rather than
// silently hitting RLS with no GUC.
function makeTenantDb(): PrismaClient {
  return new Proxy(base, {
    get(target, prop) {
      const tx = currentTx() as TxClient | null;
      if (prop === "$transaction") {
        if (tx) return txAwareTransaction(tx, target);
        return (arg: unknown, opts?: unknown) =>
          inAutoScope(async (scopedTx) => {
            if (typeof arg === "function") return (arg as (t: unknown) => unknown)(scopedTx);
            if (Array.isArray(arg)) return Promise.all(arg); // elements already routed through the proxy, each opens its own mini-tx
            return (scopedTx as unknown as { $transaction: (a: unknown, o?: unknown) => unknown }).$transaction?.(arg, opts)
              ?? (target.$transaction as (a: unknown, o?: unknown) => unknown)(arg, opts);
          });
      }
      if (tx && prop in tx) return Reflect.get(tx, prop, tx);
      if (tx) return Reflect.get(target, prop, target);

      // No ambient tx: auto-scope. Raw methods run directly inside the mini-tx.
      if (RAW.has(prop as string)) {
        const method = prop as string;
        return (...args: unknown[]) =>
          inAutoScope((scopedTx) => (scopedTx as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](...args));
      }
      // A model delegate (db.site, db.user, ...): return a Level-2 proxy whose
      // methods each open their own auto-scoped mini-tx. Mirrors the real
      // delegate for anything that isn't an actual method (symbols, `.then`,
      // unknown keys) — passthrough, not a wrapped callable — so the proxy
      // can't look thenable or fail opaquely deep inside a mini-tx.
      if (typeof prop === "string" && prop in target && !prop.startsWith("$")) {
        const model = prop;
        return new Proxy(
          {},
          {
            get(_d, method) {
              const real = (base as unknown as Record<string, Record<string, unknown>>)[model];
              if (typeof method === "symbol" || typeof real?.[method as string] !== "function") return real?.[method as string];
              return (...args: unknown[]) =>
                inAutoScope(
                  (scopedTx) =>
                    (scopedTx as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[model][method as string](...args),
                );
            },
          },
        );
      }
      return Reflect.get(target, prop, target);
    },
  }) as unknown as PrismaClient;
}

// Self-host (flag off): `db === base` (owner, no proxy/tx/GUC — RLS inert).
// Cloud (flag on): the tenant-routing proxy.
export const db = multiTenantEnabled() ? makeTenantDb() : base;
