import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { createInvite } from "@/lib/auth/invite";
import { managerBaseUrl } from "@/lib/url";
import type { Role } from "@/generated/prisma/enums";

const VALID_ROLES: Role[] = ["ADMIN", "VENDOR"];

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = typeof body.role === "string" ? (body.role as Role) : undefined;
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";

  if (!name || !email || !role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "name_email_role_required" }, { status: 400 });
  }

  const { token } = await createInvite({
    email,
    name,
    role,
    createdById: admin.id,
    phone: phone || null,
    company: company || null,
  });
  const link = `${managerBaseUrl(req)}/invite/${token}`;

  return NextResponse.json({ link });
}
