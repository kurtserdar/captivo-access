import { db } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import { listTenants } from "@/lib/platform/tenants";

export interface CustomDomainRow { tenantId: string; slug: string; tenantName: string; siteId: string; siteName: string; hostname: string; verifiedAt: Date | null; probeOk: boolean | null }

// BYO custom domains across every live tenant (each read inside its own scope).
export async function listCustomDomains(): Promise<CustomDomainRow[]> {
  const tenants = (await listTenants()).filter((t) => !t.deletedAt);
  const out: CustomDomainRow[] = [];
  for (const t of tenants) {
    const sites = await withTenant(t.id, () => db.site.findMany({ where: { customDomain: true }, select: { id: true, name: true, hostname: true, domainVerifiedAt: true, probeOk: true } })).catch(() => []);
    for (const s of sites) if (s.hostname) out.push({ tenantId: t.id, slug: t.slug, tenantName: t.name, siteId: s.id, siteName: s.name, hostname: s.hostname, verifiedAt: s.domainVerifiedAt, probeOk: s.probeOk });
  }
  return out;
}
