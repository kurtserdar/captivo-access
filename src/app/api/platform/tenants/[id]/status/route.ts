import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { setTenantStatus } from "@/lib/platform/tenants";
import { forceLogoutTenant } from "@/lib/platform/tenant-admin";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

// Suspend (ends every session) or re-activate a tenant.
export const POST = tenantRoute(async ({ req, actor, tenant, ip }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = body.status === "SUSPENDED" ? "SUSPENDED" : body.status === "ACTIVE" ? "ACTIVE" : null;
  if (!status) return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  if (tenant.deletedAt) return NextResponse.json({ error: "tenant_deleted" }, { status: 409 });
  await setTenantStatus(tenant.id, status);
  let sessions = 0;
  if (status === "SUSPENDED") sessions = await forceLogoutTenant(tenant.id).catch(() => 0);
  await recordPlatformAction({ actor, action: status === "SUSPENDED" ? "platform.tenant.suspend" : "platform.tenant.activate", tenant, clientIp: ip, summary: `${status === "SUSPENDED" ? "Suspended" : "Activated"} tenant ${tenant.slug}${sessions ? ` (${sessions} sessions ended)` : ""}`, metadata: { reason: typeof body.reason === "string" ? body.reason : undefined } });
  return NextResponse.json({ ok: true });
});
