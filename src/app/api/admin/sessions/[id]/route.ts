import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { revokeSession, currentSessionId } from "@/lib/auth/session";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "configure")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  // Never revoke your own current session from here (prevents self-lockout,
  // matching the bulk-revoke self-exclusion) — sign out via Log out instead.
  if (id === (await currentSessionId())) {
    return NextResponse.json({ error: "cannot_revoke_own_session" }, { status: 409 });
  }
  await revokeSession(id);
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "authsession.revoke",
    targetType: "session", targetId: id,
    summary: `Revoked auth session ${id}`,
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
}
