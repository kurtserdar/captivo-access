import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { UserStatus } from "@/generated/prisma/enums";

const VALID_STATUSES: string[] = Object.values(UserStatus);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = typeof body.status === "string" ? body.status : "";
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  // Self-disable guard: risk of locking out the last admin account.
  if (id === admin.id && status === "DISABLED") {
    return NextResponse.json({ error: "cannot_disable_self" }, { status: 403 });
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db.user.update({ where: { id }, data: { status: status as UserStatus } });
  return NextResponse.json({ ok: true });
}
