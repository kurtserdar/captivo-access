import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/current-user";
import { createInvite } from "@/lib/auth/invite";
import type { Role } from "@/generated/prisma/enums";

const VALID_ROLES: Role[] = ["ADMIN", "VENDOR"];

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = typeof body.role === "string" ? (body.role as Role) : undefined;

  if (!name || !email || !role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "name_email_role_required" }, { status: 400 });
  }

  const { token } = await createInvite({ email, name, role, createdById: admin.id });
  const link = `${req.nextUrl.origin}/invite/${token}`;

  return NextResponse.json({ link });
}
