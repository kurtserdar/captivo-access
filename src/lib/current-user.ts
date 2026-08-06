import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE } from "./auth/session";
import { can, type Capability } from "./auth/roles";

export async function getCurrentUser() {
  const c = await cookies();
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
