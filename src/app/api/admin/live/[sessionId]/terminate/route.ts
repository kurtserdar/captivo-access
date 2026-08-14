import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { terminateSession } from "@/lib/dataplane/client";
import { revokeGrant } from "@/lib/access/grants";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { sessionId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { grantId?: string };
  const grantId = typeof body.grantId === "string" && body.grantId ? body.grantId : null;

  const result = await terminateSession(sessionId);
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "session.terminate",
    targetType: "session", targetId: sessionId,
    summary: grantId ? `Terminated session ${sessionId} and revoked grant ${grantId}` : `Terminated session ${sessionId}`,
    clientIp: clientIp(req.headers) ?? null,
  });
  if (grantId) {
    await revokeGrant(grantId);
    await recordAdminAction({
      actor: { id: admin.id, email: admin.email },
      action: "grant.revoke",
      targetType: "grant", targetId: grantId,
      summary: `Revoked access grant ${grantId} (session terminate)`,
      clientIp: clientIp(req.headers) ?? null,
    });
  }
  return NextResponse.json({ ...result, revoked: !!grantId });
}
