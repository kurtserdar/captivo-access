import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { terminateSession } from "@/lib/dataplane/client";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { sessionId } = await ctx.params;
  const result = await terminateSession(sessionId);
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "session.terminate",
    targetType: "session", targetId: sessionId,
    summary: `Terminated session ${sessionId}`,
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json(result);
}
