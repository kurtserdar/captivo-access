import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { removePlatformAdmin } from "@/lib/platform/admins";
import { PlatformError } from "@/lib/platform/tenants";
import { recordPlatformAction } from "@/lib/platform/audit";
import { clientIp } from "@/lib/request-ip";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const DELETE = withTenantRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const me = await requirePlatformAdmin();
  const { id } = await params;
  const target = await db.user.findUnique({ where: { id }, select: { email: true } });
  try {
    await removePlatformAdmin(id, me.id);
  } catch (e) {
    if (e instanceof PlatformError) return NextResponse.json({ error: e.code }, { status: e.code === "not_found" ? 404 : 409 });
    throw e;
  }
  await recordPlatformAction({ actor: { id: me.id, email: me.email }, action: "platform.admin.remove", targetType: "user", targetId: id, clientIp: clientIp(req.headers) ?? null, summary: `Removed platform operator ${target?.email ?? id}` });
  return NextResponse.json({ ok: true });
});
