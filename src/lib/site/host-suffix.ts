import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { accessDomain } from "@/lib/domain/custom-domain";
import { resolveRequestTenantSlug } from "@/lib/tenant/request";

// The fixed, server-owned suffix appended to a vendor resource's subdomain LABEL
// to form its public hostname. The operator/tenant only ever types the label.
//
// - Self-host (single tenant): `.<accessDomain>` → e.g. label "wiki" ⇒
//   "wiki.access.example.com". Unchanged.
// - Cloud (multi-tenant): `-<slug>.<accessDomain>` → the tenant's slug is embedded
//   in the single DNS label so every tenant has its own namespace under the one
//   shared "*.<accessDomain>" wildcard: label "wiki" in tenant "acme" ⇒
//   "wiki-acme.sites.cloud.captivo.io". Two tenants can both use "wiki" without
//   collision, and no tenant can name or spoof another's host.
//
// Returns null when no access domain is configured (dev/misconfig) — callers then
// treat the field as a plain full hostname.
export async function siteHostSuffix(): Promise<string | null> {
  const domain = accessDomain(process.env.MANAGER_PUBLIC_URL, process.env.ACCESS_DOMAIN);
  if (!domain) return null;
  if (multiTenantEnabled()) {
    const slug = await resolveRequestTenantSlug();
    if (slug) return `-${slug}.${domain}`;
  }
  return `.${domain}`;
}
