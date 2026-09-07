import { base } from "@/lib/db";
import { withScope } from "@/lib/tenant/context";
import { multiTenantEnabled } from "@/lib/tenant/enabled";

// Establishes the tenant scope for `fn` (and everything it awaits).
//
// Multi-tenant (cloud): opens a request transaction, sets the transaction-local
// tenant GUC on its connection, and stores the tx in ALS so `db` routes every
// query onto it — Postgres RLS scopes reads and a BEFORE INSERT trigger stamps
// tenantId on writes, both from the same GUC. Leak-proof: the GUC is
// transaction-local, so a pooled connection never carries it across requests.
//
// Single-tenant (self-host, flag off): a plain ALS tenant scope, no transaction —
// the owner role bypasses RLS and behavior is unchanged.
//
// Lives in its own module (not context.ts) so context.ts stays db-free and the
// import graph is acyclic: context ← db ← scope.
export function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  if (!multiTenantEnabled()) return withScope({ tenantId }, fn);
  return base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return withScope({ tenantId, tx }, fn);
  });
}
