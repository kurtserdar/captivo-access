import { requireAdmin } from "@/lib/current-user";
import { getSmtpConfig } from "@/lib/email/mailer";
import { LastVerified } from "@/app/(app)/_shell/last-verified";
import { EmailForm } from "./email-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email" };

export default async function AdminEmailPage() {
  const admin = await requireAdmin();
  const cfg = await getSmtpConfig();
  const initial = cfg
    ? { host: cfg.host, port: cfg.port, secure: cfg.secure, username: cfg.username, fromName: cfg.fromName, fromEmail: cfg.fromEmail, enabled: cfg.enabled, hasPassword: true }
    : { host: "", port: 587, secure: false, username: "", fromName: "Captivo Access", fromEmail: "", enabled: false, hasPassword: false };

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="page-title-row"><span className="page-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg></span><h1>Email</h1></div>
          <p>Configure outbound SMTP — used to deliver invite links and admin notifications.</p>
        </div>
      </div>
      <div className="card">
        <LastVerified at={cfg?.lastVerifiedAt ?? null} ok={cfg?.lastVerifiedOk ?? null} detail={cfg?.lastVerifiedDetail ?? null} />
        <EmailForm initial={initial} adminEmail={admin.email} />
      </div>
    </main>
  );
}
