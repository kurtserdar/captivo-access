import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { purgeTenant } from "@/lib/platform/tenants";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

// Permanent: every row of the (already soft-deleted) tenant is removed.
export const POST = tenantRoute(async ({ req, actor, tenant, ip }) => {
  if (!tenant.deletedAt) return NextResponse.json({ error: "not_deleted" }, { status: 409 });
  const b = (await req.json().catch(() => ({}))) as { confirmSlug?: string };
  if (b.confirmSlug !== tenant.slug) return NextResponse.json({ error: "confirm_mismatch" }, { status: 400 });
  // Platform chain only — the tenant's chain is gone with the tenant.
  await recordPlatformAction({ actor, action: "platform.tenant.purge", tenant: null, targetType: "tenant", targetId: tenant.id, clientIp: ip, summary: `Purged tenant ${tenant.slug} permanently`, metadata: { slug: tenant.slug, name: tenant.name } });
  await purgeTenant(tenant.id);
  return NextResponse.json({ ok: true });
});
