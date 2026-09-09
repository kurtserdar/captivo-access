import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE } from "./auth/session";
import { can, type Capability } from "./auth/roles";
import { SUPPORT_COOKIE } from "./support/session";

export async function getCurrentUser() {
  const c = await cookies();
  // A live support session (host-only cookie set by the tenant-host handoff)
  // takes precedence over the shared-domain ca_session, which on a tenant host
  // would be the platform admin's own — invisible under this tenant's RLS anyway.
  const support = c.get(SUPPORT_COOKIE)?.value;
  if (support) {
    const u = await getSessionUser(support);
    if (u) return u;
  }
  const token = c.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
}
export async function requireUser() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}
export async function requireCapability(cap: Capability) {
  const u = await requireUser();
  if (!can(u.role, cap)) redirect("/");
  return u;
}
export async function requireAdmin() {
  return requireCapability("configure");
}
