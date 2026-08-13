import { requireAdmin } from "@/lib/current-user";
import { InviteIcon } from "@/components/icons";
import { db } from "@/lib/db";
import { getSmtpConfig } from "@/lib/email/mailer";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AddInviteButton } from "./add-invite-button";
import { InvitesTable, type InviteRow } from "./invites-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invites" };

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
  const rows: InviteRow[] = invites.map((inv) => ({
    id: inv.id,
    name: inv.name,
    email: inv.email,
    company: inv.company,
    phone: inv.phone,
    roleLabel: ROLE_LABELS[inv.role] ?? inv.role,
    status: inviteStatus(inv),
    expiresAt: inv.expiresAt.toISOString(),
  }));

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
        <InvitesTable rows={rows} />
      )}
    </main>
  );
}
