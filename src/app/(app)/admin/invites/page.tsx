import { requireAdmin } from "@/lib/current-user";
import { InviteIcon } from "@/components/icons";
import { db } from "@/lib/db";
import { getSmtpConfig } from "@/lib/email/mailer";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AddInviteButton } from "./add-invite-button";
import { ResendInviteButton } from "./resend-invite-button";
import { CancelInviteButton } from "./cancel-invite-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invites" };

const STATUS_PILL: Record<string, string> = {
  Used: "ok",
  Expired: "danger",
  Pending: "warn",
};

function inviteStatus(inv: { usedAt: Date | null; expiresAt: Date }): string {
  if (inv.usedAt) return "Used";
  if (inv.expiresAt < new Date()) return "Expired";
  return "Pending";
}

export default async function AdminInvitesPage() {
  await requireAdmin();

  const smtp = await getSmtpConfig();
  const smtpEnabled = !!smtp?.enabled;

  const invites = await db.invite.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="page-title-row"><span className="page-icon"><InviteIcon /></span><h1>Invitations</h1></div>
          <p>Invite a new vendor or admin. The invite link is shown only once.</p>
        </div>
        <AddInviteButton smtpEnabled={smtpEnabled} />
      </div>

      <h2>Sent invites</h2>
      {invites.length === 0 ? (
        <div className="empty">No invites have been sent yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const status = inviteStatus(inv);
                return (
                  <tr key={inv.id}>
                    <td>{inv.name}</td>
                    <td className="cell-sub">{inv.email}</td>
                    <td>
                      <div>{inv.company ?? "—"}</div>
                      {inv.phone && <div className="cell-sub">{inv.phone}</div>}
                    </td>
                    <td>{ROLE_LABELS[inv.role] ?? inv.role}</td>
                    <td>
                      <span className={`pill ${STATUS_PILL[status] ?? "neutral"}`}>{status}</span>
                    </td>
                    <td className="cell-sub"><LocalTime iso={inv.expiresAt.toISOString()} /></td>
                    <td>
                      {status !== "Used" && (
                        <div className="row-actions">
                          <ResendInviteButton id={inv.id} email={inv.email} />
                          <CancelInviteButton id={inv.id} email={inv.email} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
