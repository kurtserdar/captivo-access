import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant/context";
import { decrypt } from "@/lib/crypto";
import { buildTransportOptions } from "./transport";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { PLATFORM_TENANT_ID } from "@/lib/tenant/constants";

type SmtpLike = { host: string; port: number; secure: boolean; username: string; password: string; fromName: string; fromEmail: string; enabled: boolean };

// The tenant's own SMTP row (what the Email settings page shows/edits).
export async function getSmtpConfig() {
  try {
    return await db.smtpConfig.findUnique({ where: { tenantId: currentTenantId() } });
  } catch {
    // If the table doesn't exist yet (deployed before db push) or the DB is
    // unavailable, treat SMTP as unconfigured so notifications still work.
    return null;
  }
}

// The config mail is actually SENT with: the tenant's own when enabled, else
// (Cloud, opt-in) the platform tenant's.
export async function getSendingSmtpConfig(): Promise<SmtpLike | null> {
  const own = await getSmtpConfig();
  if (own?.enabled) return own;
  // Cloud: a tenant with no (enabled) mail of its own may fall back to the
  // platform tenant's SMTP when the platform operator has turned that on.
  if (multiTenantEnabled() && currentTenantId() !== PLATFORM_TENANT_ID) {
    try {
      const { getPlatformConfig } = await import("@/lib/platform/config");
      const { platformSmtpConfig } = await import("@/lib/platform/sql");
      if ((await getPlatformConfig()).smtpFallback) {
        const p = await platformSmtpConfig();
        if (p) return { ...p, enabled: true };
      }
    } catch {
      /* fall through to the tenant's own (disabled/missing) config */
    }
  }
  return own;
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
    const cfg = await getSendingSmtpConfig();
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
