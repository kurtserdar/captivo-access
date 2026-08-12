import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const invite = await db.invite.findUnique({ where: { id }, select: { usedAt: true } });
  if (!invite) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "already_used" }, { status: 409 });

  // Atomically delete only if still pending: if it was enrolled between the
  // read above and here, deleteMany matches 0 rows and we bail — never
  // deleting an invite that has since been consumed.
  const deleted = await db.invite.deleteMany({ where: { id, usedAt: null } });
  if (deleted.count === 0) return NextResponse.json({ error: "already_used" }, { status: 409 });
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "invite.revoke",
    targetType: "invite", targetId: id,
    summary: `Revoked invite ${id}`,
    clientIp: clientIp(req.headers) ?? null,
  });

  return NextResponse.json({ ok: true });
}
