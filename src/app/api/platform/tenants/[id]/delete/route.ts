import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { deleteTenant, PURGE_AFTER_DAYS } from "@/lib/platform/tenants";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

// Soft delete: consoles/sites stop resolving, sessions end, restorable for PURGE_AFTER_DAYS.
export const POST = tenantRoute(async ({ req, actor, tenant, ip }) => {
  const b = (await req.json().catch(() => ({}))) as { confirmSlug?: string };
  if (b.confirmSlug !== tenant.slug) return NextResponse.json({ error: "confirm_mismatch" }, { status: 400 });
  // Record in the tenant's own chain BEFORE it disappears from resolvers.
  await recordPlatformAction({ actor, action: "platform.tenant.delete", tenant, clientIp: ip, summary: `Deleted tenant ${tenant.slug} (purge in ${PURGE_AFTER_DAYS} days)` });
  await deleteTenant(tenant.id);
  return NextResponse.json({ ok: true });
});
