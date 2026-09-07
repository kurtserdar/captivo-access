import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
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
export async function requirePlatformAdmin() {
  const u = await getCurrentUser();
  if (!isPlatformAdmin(u?.role)) notFound();
  return u!;
}
