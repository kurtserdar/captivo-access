import { base } from "@/lib/db";

// slugFromHost / RESERVED live in console-domain.ts (pure, no DB); re-exported
// here so existing callers and tests are unchanged.
export { slugFromHost, RESERVED } from "./console-domain";

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
