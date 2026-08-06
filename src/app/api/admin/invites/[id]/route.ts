import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const invite = await db.invite.findUnique({ where: { id }, select: { usedAt: true } });
  if (!invite) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "already_used" }, { status: 409 });

  await db.invite.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
