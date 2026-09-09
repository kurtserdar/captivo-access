import { db } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant/context";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { consoleDomain } from "@/lib/tenant/console-domain";

// The acting tenant's console base URL (no trailing slash) for links built
// OUTSIDE a request (emails from route handlers and crons). Cloud: the tenant's
// own host, `https://<slug>.<consoleDomain>` (its own Tenant row is readable
// under RLS). Self-host / unresolvable: MANAGER_PUBLIC_URL, "" when unset.
export async function consoleBaseUrl(): Promise<string> {
  if (multiTenantEnabled()) {
    const domain = consoleDomain();
    if (domain) {
      try {
        const t = await db.tenant.findUnique({ where: { id: currentTenantId() }, select: { slug: true } });
        if (t?.slug) return `https://${t.slug}.${domain}`;
      } catch {
        /* fall through to the configured URL */
      }
    }
  }
  return (process.env.MANAGER_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
}
