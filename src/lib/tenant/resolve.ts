import { base } from "@/lib/db";

// Subdomain labels that are never a tenant slug (the manager host + common
// infra names live under the access domain too).
export const RESERVED = new Set(["manager", "www", "app", "admin", "api"]);

// Extracts the single-label tenant slug from a request host, given the bare
// access domain (e.g. "access.example.com"). `<slug>.<accessDomain>` → slug;
// the bare domain, a reserved label, a multi-label subdomain, a non-matching
// host, or a null access domain → null. Pure.
export function slugFromHost(host: string, accessDomain: string | null): string | null {
  if (!host || !accessDomain) return null;
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const suffix = "." + accessDomain.toLowerCase();
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!label || label.includes(".") || RESERVED.has(label)) return null;
  return label;
}

// Maps a tenant slug to its id via the SECURITY DEFINER function (RLS-bypass, so
// it works from the app role with no tenant scope set). Returns null if unknown.
export async function resolveTenantBySlug(slug: string): Promise<string | null> {
  const rows = await base.$queryRawUnsafe<{ id: string | null }[]>("SELECT resolve_tenant_by_slug($1) AS id", slug);
  return rows[0]?.id ?? null;
}

// Maps a resource hostname to its tenant id (for the data-plane by-host path).
export async function resolveTenantByHostname(host: string): Promise<string | null> {
  const rows = await base.$queryRawUnsafe<{ id: string | null }[]>("SELECT resolve_tenant_by_hostname($1) AS id", host.toLowerCase().trim());
  return rows[0]?.id ?? null;
}
