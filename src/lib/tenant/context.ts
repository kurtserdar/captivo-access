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

// Returns `row` with tenantId set to the active tenant when it has none. Used by
// the db extension (Task 4) to stamp create/upsert payloads. Leaves an explicit
// tenantId untouched (so cross-tenant writes stay expressible and are caught by
// RLS in Phase 0b). Non-objects pass through unchanged.
export function fillTenant<T>(row: T): T {
  if (row && typeof row === "object" && !("tenantId" in (row as Record<string, unknown>))) {
    return { ...(row as Record<string, unknown>), tenantId: currentTenantId() } as T;
  }
  return row;
}

// Adds tenantId to a Prisma `where` filter when the caller didn't set one. Used
// by the db extension (Phase 0b-2) to tenant-scope list/filter operations
// (findMany, findFirst, count, aggregate, groupBy, updateMany, deleteMany) at
// the ORM layer. An explicit tenantId is left untouched.
export function whereTenant<A extends { where?: Record<string, unknown> }>(args: A): A {
  const where = (args?.where ?? {}) as Record<string, unknown>;
  if (!("tenantId" in where)) {
    return { ...args, where: { ...where, tenantId: currentTenantId() } } as A;
  }
  return args;
}
