import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { accessDomain } from "@/lib/domain/custom-domain";
import { slugFromHost, resolveTenantBySlug } from "@/lib/tenant/resolve";
import { withTenant } from "@/lib/tenant/scope";
import { multiTenantEnabled } from "@/lib/tenant/enabled";

// Resolves the request's tenant from its host: <slug>.<accessDomain> → slug →
// tenant id (via the SECURITY DEFINER resolver). Null when the host carries no
// tenant slug or the slug is unknown.
export async function resolveRequestTenant(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const slug = slugFromHost(host, accessDomain(process.env.MANAGER_PUBLIC_URL, process.env.ACCESS_DOMAIN));
  if (!slug) return null;
  return resolveTenantBySlug(slug);
}

// Wraps a route handler so its DB work runs under the request's tenant scope.
// Self-host (flag off): pass-through, unchanged. Cloud: resolve the tenant and
// enter withTenant; an unresolvable host is a 404 (unknown tenant).
export function withTenantRoute<A extends unknown[]>(
  handler: (...a: A) => Promise<Response>,
): (...a: A) => Promise<Response> {
  return async (...a: A) => {
    if (!multiTenantEnabled()) return handler(...a);
    const tenantId = await resolveRequestTenant();
    if (!tenantId) return NextResponse.json({ error: "unknown_tenant" }, { status: 404 });
    return withTenant(tenantId, () => handler(...a));
  };
}

// Wraps an RSC page/layout body so its DB work runs under the request's tenant
// scope. Each RSC render is invoked independently, so each wraps its own body.
// Self-host: pass-through. Cloud: resolve + withTenant; unresolvable host → 404.
export async function withRequestTenant<T>(fn: () => Promise<T>): Promise<T> {
  if (!multiTenantEnabled()) return fn();
  const tenantId = await resolveRequestTenant();
  if (!tenantId) notFound();
  return withTenant(tenantId, fn);
}
