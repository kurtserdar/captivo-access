import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { accessDomain } from "@/lib/domain/custom-domain";
import { resolveRequestTenantSlug } from "@/lib/tenant/request";

// The fixed, server-owned suffix appended to a vendor resource's subdomain LABEL
// to form its public hostname. The operator/tenant only ever types the label.
//
// - Self-host (single tenant): `.<accessDomain>` → label "wiki" ⇒
//   "wiki.access.example.com". Unchanged.
// - Cloud (multi-tenant): `.<slug>.<consoleDomain>` → the vendor site is a
//   subdomain of the tenant's own console domain, giving each tenant its own
//   namespace: label "wiki" in tenant "acme" ⇒ "wiki.acme.cloud.captivo.io".
//   Two tenants can both use "wiki"; a site (depth-3) can never collide with a
//   console (depth-2) or another tenant's namespace.
//
// Returns null when no domain is configured (dev/misconfig) — callers then treat
// the field as a plain full hostname.
export async function siteHostSuffix(): Promise<string | null> {
  if (multiTenantEnabled()) {
    const consoleDomain =
      process.env.CONSOLE_DOMAIN?.trim() ||
      accessDomain(process.env.MANAGER_PUBLIC_URL, process.env.ACCESS_DOMAIN);
    const slug = await resolveRequestTenantSlug();
    if (slug && consoleDomain) return `.${slug}.${consoleDomain}`;
  }
  const domain = accessDomain(process.env.MANAGER_PUBLIC_URL, process.env.ACCESS_DOMAIN);
  return domain ? `.${domain}` : null;
}
