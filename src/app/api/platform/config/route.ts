import { NextResponse } from "next/server";
import { platformRoute } from "@/lib/platform/route";
import { savePlatformConfig, parseNewTenantDefaults, getPlatformConfig } from "@/lib/platform/config";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

export const GET = platformRoute(async () => NextResponse.json(await getPlatformConfig()));

export const POST = platformRoute(async ({ req, actor, ip }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const until = typeof b.announcementUntil === "string" && b.announcementUntil ? new Date(b.announcementUntil) : null;
  if (until && Number.isNaN(until.getTime())) return NextResponse.json({ error: "invalid_until" }, { status: 400 });
  const opsEmail = typeof b.opsEmail === "string" ? b.opsEmail.trim() : "";
  if (opsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opsEmail)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  await savePlatformConfig({
    announcementText: typeof b.announcementText === "string" ? b.announcementText.slice(0, 300) : null,
    announcementLevel: (b.announcementLevel === "warn" || b.announcementLevel === "danger" ? b.announcementLevel : "info"),
    announcementUntil: until,
    newTenantDefaults: parseNewTenantDefaults(b.defaults),
    opsEmail: opsEmail || null,
    smtpFallback: b.smtpFallback === true,
    signupEnabled: b.signupEnabled === true,
  });
  await recordPlatformAction({ actor, action: "platform.config.update", targetType: "platform", clientIp: ip, summary: "Updated platform settings", metadata: { announcement: !!(typeof b.announcementText === "string" && b.announcementText.trim()), smtpFallback: b.smtpFallback === true, signupEnabled: b.signupEnabled === true } });
  return NextResponse.json({ ok: true });
});
