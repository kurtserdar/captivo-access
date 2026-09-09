import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { restoreTenant } from "@/lib/platform/tenants";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

export const POST = tenantRoute(async ({ actor, tenant, ip }) => {
  if (!tenant.deletedAt) return NextResponse.json({ error: "not_deleted" }, { status: 409 });
  await restoreTenant(tenant.id);
  await recordPlatformAction({ actor, action: "platform.tenant.restore", tenant, clientIp: ip, summary: `Restored tenant ${tenant.slug}` });
  return NextResponse.json({ ok: true });
});
