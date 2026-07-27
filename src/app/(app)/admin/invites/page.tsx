import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

function inviteStatus(inv: { usedAt: Date | null; expiresAt: Date }): string {
  if (inv.usedAt) return "Used";
  if (inv.expiresAt < new Date()) return "Expired";
  return "Pending";
}

export default async function AdminInvitesPage() {
  await requireAdmin();

  const invites = await db.invite.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/sessions">Sessions</Link>
        <Link href="/admin/invites" className="active">
          Invites
        </Link>
      </nav>

      <h1>Invites</h1>
      <p>Invite a new vendor or admin. The invite link is shown only once.</p>
      <InviteForm />

      <h2>Sent invites</h2>
      {invites.length === 0 ? (
        <p>No invites have been sent yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.name}</td>
                <td>{inv.email}</td>
                <td>{inv.role}</td>
                <td>{inviteStatus(inv)}</td>
                <td>{inv.expiresAt.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
