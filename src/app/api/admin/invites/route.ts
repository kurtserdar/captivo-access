import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can, ASSIGNABLE_ROLES } from "@/lib/auth/roles";
import { createInvite } from "@/lib/auth/invite";
import { normalizeEmail } from "@/lib/auth/email";
import { managerBaseUrl } from "@/lib/url";
import { getSmtpConfig, sendMail } from "@/lib/email/mailer";
import { inviteEmail } from "@/lib/email/templates";
import type { Role } from "@/generated/prisma/enums";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "configure")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const role = typeof body.role === "string" ? (body.role as Role) : undefined;
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const sendEmail = body.sendEmail === true;

  if (!name || !email || !role || !ASSIGNABLE_ROLES.includes(role)) {
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

  let emailed = false;
  if (sendEmail) {
    try {
      const smtp = await getSmtpConfig();
      if (smtp?.enabled) {
        const m = inviteEmail({ name, link });
        const r = await sendMail({ to: email, subject: m.subject, html: m.html, text: m.text });
        emailed = r.sent;
      }
    } catch {
      // best-effort: email must never fail invite creation
    }
  }

  return NextResponse.json({ link, emailed: sendEmail ? emailed : null });
}
