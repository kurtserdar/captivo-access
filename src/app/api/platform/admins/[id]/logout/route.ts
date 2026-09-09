import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { endPlatformAdminSessions } from "@/lib/platform/admins";
import { recordPlatformAction } from "@/lib/platform/audit";
import { clientIp } from "@/lib/request-ip";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const me = await requirePlatformAdmin();
  const { id } = await params;
  const n = await endPlatformAdminSessions(id);
  await recordPlatformAction({ actor: { id: me.id, email: me.email }, action: "platform.admin.force_logout", targetType: "user", targetId: id, clientIp: clientIp(req.headers) ?? null, summary: `Ended ${n} platform operator session(s)`, metadata: { sessions: n } });
  return NextResponse.json({ ok: true, sessions: n });
});
