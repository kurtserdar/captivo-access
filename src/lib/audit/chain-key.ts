import { currentTenantId } from "@/lib/tenant/context";

// The two tamper-evidence chains. Each tenant has one head row per scope in
// AuditChainState (was the fixed ids "singleton" / "admin-singleton").
export type ChainScope = "access" | "admin";

// Composite unique key for a tenant's chain head of the given scope.
export function chainKey(scope: ChainScope) {
  return { tenantId_scope: { tenantId: currentTenantId(), scope } };
}
