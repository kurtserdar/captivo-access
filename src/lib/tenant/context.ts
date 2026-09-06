import { AsyncLocalStorage } from "node:async_hooks";

// The implicit tenant for the self-hosted single-tenant product, and the
// fallback whenever no tenant scope has been established.
export const DEFAULT_TENANT = "default";

const als = new AsyncLocalStorage<{ tenantId: string }>();

// Runs `fn` with `tenantId` as the active tenant for the duration of the call
// (and anything it awaits). Nests correctly — an inner scope restores the outer
// one on exit.
export function withTenant<T>(tenantId: string, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

// The active tenant, or DEFAULT_TENANT when no scope is set (self-host / Phase
// 0a, where the context is never entered).
export function currentTenantId(): string {
  return als.getStore()?.tenantId ?? DEFAULT_TENANT;
}

// Adds `tenantId: currentTenantId()` to a Prisma create/upsert `data` payload
// when the caller didn't set one. Used by the db extension (Task 4). Leaves an
// explicit tenantId untouched (so cross-tenant writes are still expressible and
// caught by RLS in Phase 0b).
export function injectTenant<A extends { data?: Record<string, unknown> }>(args: A): A {
  if (args.data && !("tenantId" in args.data)) {
    return { ...args, data: { ...args.data, tenantId: currentTenantId() } };
  }
  return args;
}
