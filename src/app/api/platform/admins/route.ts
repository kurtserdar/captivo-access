import { NextResponse } from "next/server";
import { platformRoute } from "@/lib/platform/route";
import { invitePlatformAdmin } from "@/lib/platform/admins";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

export const POST = platformRoute(async ({ req, actor, ip }) => {
  const b = (await req.json().catch(() => ({}))) as { email?: string; name?: string };
  const r = await invitePlatformAdmin({ email: typeof b.email === "string" ? b.email : "", name: typeof b.name === "string" ? b.name : undefined });
  await recordPlatformAction({ actor, action: "platform.admin.invite", targetType: "user", clientIp: ip, summary: `Invited platform operator ${b.email}`, metadata: { email: b.email } });
  return NextResponse.json({ ok: true, ...r });
});
