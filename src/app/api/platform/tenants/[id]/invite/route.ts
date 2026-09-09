import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { inviteTenantAdmin } from "@/lib/platform/tenant-admin";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

// Invite an ADMIN into the tenant (first-admin re-invite, lock-out recovery, extra admin).
export const POST = tenantRoute(async ({ req, actor, tenant, ip }) => {
  if (tenant.deletedAt) return NextResponse.json({ error: "tenant_deleted" }, { status: 409 });
  const b = (await req.json().catch(() => ({}))) as { email?: string; name?: string };
  const r = await inviteTenantAdmin(tenant, { email: typeof b.email === "string" ? b.email : "", name: typeof b.name === "string" ? b.name : undefined });
  await recordPlatformAction({ actor, action: "platform.tenant.invite_admin", tenant, clientIp: ip, summary: `Invited admin ${b.email} into ${tenant.slug}${r.emailed ? " (emailed)" : " (link only)"}`, metadata: { email: b.email, emailed: r.emailed } });
  return NextResponse.json({ ok: true, inviteUrl: r.inviteUrl, emailed: r.emailed });
});
