import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can, ASSIGNABLE_ROLES } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { UserStatus } from "@/generated/prisma/enums";

const VALID_STATUSES: string[] = Object.values(UserStatus);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "configure")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const status = typeof body.status === "string" ? body.status : undefined;
  const role = typeof body.role === "string" ? body.role : undefined;

  if (!status && !role) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  // Validate status if provided
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  // Self-disable guard: risk of locking out the last admin account.
  if (status !== undefined && id === admin.id && status === "DISABLED") {
    return NextResponse.json({ error: "cannot_disable_self" }, { status: 403 });
  }

  // Validate and apply role if provided
  if (role !== undefined) {
    if (!ASSIGNABLE_ROLES.includes(role as (typeof ASSIGNABLE_ROLES)[number])) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
    if (id === admin.id) {
      return NextResponse.json({ error: "cannot_change_own_role" }, { status: 403 });
    }
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};
  if (status !== undefined) {
    updateData.status = status as UserStatus;
  }
  if (role !== undefined) {
    updateData.role = role as (typeof ASSIGNABLE_ROLES)[number];
  }

  await db.user.update({ where: { id }, data: updateData });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) return NextResponse.json({ error: "cannot_delete_self" }, { status: 403 });

  const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.role === "ADMIN") return NextResponse.json({ error: "cannot_delete_admin" }, { status: 403 });

  // Cascades Passkey/TotpSecret/Session/own-AccessGrant; SetNulls the creator/
  // approver attribution on other users' invites/grants; AuditEvent +
  // SessionRecording (no relation) are untouched.
  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
