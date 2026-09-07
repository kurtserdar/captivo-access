import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { currentTenantId } from "@/lib/tenant/context";
import { PLATFORM_TENANT_ID } from "@/lib/tenant/constants";
import type { Role } from "@/generated/prisma/enums";

// Pure authorization predicate. A platform admin is any user with the PLATFORM
// role — which only exists in the reserved platform tenant, so at a tenant host
// the platform admin's session does not resolve (RLS) and getCurrentUser is null.
export function isPlatformAdmin(role: Role | undefined | null): boolean {
  return role === "PLATFORM";
}

// Route/page guard for the platform console. Must run INSIDE the request-tenant
// scope (the caller wraps with withRequestTenant/withTenantRoute) so
// getCurrentUser resolves the session under the platform tenant.
//
// Defense-in-depth: this asserts BOTH that the current request is scoped to the
// reserved platform tenant AND that the session's role is PLATFORM. Role alone
// would suffice under correct RLS, but pinning the tenant too means a bug that
// mis-scopes the request (or mis-resolves the session) still 404s here instead
// of silently granting platform access. On self-host (flag off) currentTenantId()
// is always DEFAULT_TENANT ("default" ≠ "platform"), so this 404s exactly as
// before — no behavior change there.
export async function requirePlatformAdmin() {
  const u = await getCurrentUser();
  if (currentTenantId() !== PLATFORM_TENANT_ID || !isPlatformAdmin(u?.role)) notFound();
  return u!;
}
