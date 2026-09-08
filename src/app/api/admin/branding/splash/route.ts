import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant/context";
import { parseSplashUpload } from "@/lib/branding/splash";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";
import { withTenantRoute } from "@/lib/tenant/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export const POST = withTenantRoute(async (req: Request) => {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { splashImage?: unknown; splashImageType?: unknown };
  const parsed = parseSplashUpload(body.splashImage, body.splashImageType);
  if (parsed.action === "error") return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.action === "clear") {
    await db.brandingConfig.upsert({ where: { tenantId: currentTenantId() }, create: { tenantId: currentTenantId() }, update: { splashImage: null, splashImageType: null } });
  } else {
    await db.brandingConfig.upsert({
      where: { tenantId: currentTenantId() },
      create: { tenantId: currentTenantId(), splashImage: parsed.data, splashImageType: parsed.type },
      update: { splashImage: parsed.data, splashImageType: parsed.type },
    });
  }
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "branding.update",
    targetType: "branding", targetId: "splash",
    summary: parsed.action === "clear" ? "Removed the custom splash image" : "Updated the custom splash image",
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withTenantRoute(async (req: Request) => {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.brandingConfig.upsert({ where: { tenantId: currentTenantId() }, create: { tenantId: currentTenantId() }, update: { splashImage: null, splashImageType: null } });
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "branding.update",
    targetType: "branding", targetId: "splash",
    summary: "Removed the custom splash image",
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
});
