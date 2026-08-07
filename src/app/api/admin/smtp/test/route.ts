import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { sendTestEmail } from "@/lib/email/mailer";
import { db } from "@/lib/db";
import { verifyResultFields } from "@/lib/admin/verify-result";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = typeof b.to === "string" && b.to.trim() ? b.to.trim() : admin.email;
  const result = await sendTestEmail(to);
  await db.smtpConfig.updateMany({
    where: { id: "singleton" },
    data: verifyResultFields(result.sent, result.sent ? null : (result.reason ?? "send_failed"), new Date()),
  });
  return NextResponse.json(result);
}
