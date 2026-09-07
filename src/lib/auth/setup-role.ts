import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { currentTenantId } from "@/lib/tenant/context";
import { PLATFORM_TENANT_ID } from "@/lib/tenant/constants";

// Decides what /setup (first-run) does for the current request:
// - self-host (flag off): create the first ADMIN — unchanged behavior.
// - Cloud + platform host: create the first PLATFORM super-admin.
// - Cloud + any tenant host: disallowed — tenant admins arrive via invite.
export type SetupRole = { allowed: false } | { allowed: true; role: "ADMIN" | "PLATFORM" };

export function resolveSetupRole(): SetupRole {
  if (!multiTenantEnabled()) return { allowed: true, role: "ADMIN" };
  if (currentTenantId() === PLATFORM_TENANT_ID) return { allowed: true, role: "PLATFORM" };
  return { allowed: false };
}
