import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { forceLogoutTenant } from "@/lib/platform/tenant-admin";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

// End every session in the tenant (console + portal).
export const POST = tenantRoute(async ({ actor, tenant, ip }) => {
  const n = await forceLogoutTenant(tenant.id);
  await recordPlatformAction({ actor, action: "platform.tenant.force_logout", tenant, clientIp: ip, summary: `Ended all ${n} sessions in ${tenant.slug}`, metadata: { sessions: n } });
  return NextResponse.json({ ok: true, sessions: n });
});
