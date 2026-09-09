import { tenantRoute } from "@/lib/platform/route";
import { exportTenant } from "@/lib/platform/tenant-admin";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

// JSON export of the tenant (configuration, users, resources, grants, audit; no recordings).
export const GET = tenantRoute(async ({ actor, tenant, ip }) => {
  const data = await exportTenant(tenant.id);
  await recordPlatformAction({ actor, action: "platform.tenant.export", tenant, clientIp: ip, summary: `Exported tenant ${tenant.slug}` });
  const body = JSON.stringify(data, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="captivo-tenant-${tenant.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
});
