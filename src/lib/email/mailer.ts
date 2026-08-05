import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { buildTransportOptions } from "./transport";

export function getSmtpConfig() {
  return db.smtpConfig.findUnique({ where: { id: "singleton" } });
}

export async function getAdminEmails(): Promise<string[]> {
  const admins = await db.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { email: true },
  });
  return admins.map((a) => a.email);
}

export type MailMessage = { to: string | string[]; subject: string; html: string; text: string };

// Best-effort: returns a result, never throws into the caller's flow.
export async function sendMail(msg: MailMessage): Promise<{ sent: boolean; reason?: string }> {
  try {
    const cfg = await getSmtpConfig();
    if (!cfg) return { sent: false, reason: "not_configured" };
    if (!cfg.enabled) return { sent: false, reason: "disabled" };
    const transport = nodemailer.createTransport(
      buildTransportOptions({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        username: cfg.username,
        password: decrypt(cfg.password),
      }),
    );
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "send_failed" };
  }
}

export async function sendTestEmail(to: string): Promise<{ sent: boolean; reason?: string }> {
  return sendMail({
    to,
    subject: "Captivo Access — SMTP test",
    html: "<p>This is a test email from Captivo Access. Your SMTP settings are working.</p>",
    text: "This is a test email from Captivo Access. Your SMTP settings are working.",
  });
}
