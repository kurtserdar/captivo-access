import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { resolveTenantByHostname } from "@/lib/tenant/internal";
import { resolveRequestTenant } from "@/lib/tenant/request";

// In cloud (multi-tenant), vendor-site hostnames share one wildcard domain, so a
// hostname must be globally unique across tenants for host→tenant routing to be
// unambiguous. Returns true when `hostname` is already owned by a DIFFERENT
// tenant than the request's. Self-host (flag off): always false — the per-tenant
// DB unique constraint already covers the single-tenant case unchanged.
export async function crossTenantHostnameTaken(hostname: string | null | undefined): Promise<boolean> {
  if (!multiTenantEnabled() || !hostname) return false;
  const owner = await resolveTenantByHostname(hostname);
  if (!owner) return false;
  const acting = await resolveRequestTenant();
  return owner !== acting;
}
