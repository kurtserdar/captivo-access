import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { RevokeSessionButton } from "./revoke-session-button";

export const dynamic = "force-dynamic";

export default async function AdminSessionsPage() {
  await requireAdmin();

  const sessions = await db.session.findMany({
    where: { expiresAt: { gt: new Date() } },
    select: {
      id: true,
      ip: true,
      userAgent: true,
      lastSeenAt: true,
      createdAt: true,
      user: { select: { email: true, name: true } },
    },
    orderBy: { lastSeenAt: "desc" },
  });

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/sessions" className="active">
          Sessions
        </Link>
        <Link href="/admin/invites">Invites</Link>
      </nav>

      <h1>Sessions</h1>
      <p>All currently active (non-expired) sessions.</p>

      {sessions.length === 0 ? (
        <p>No active sessions.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>IP</th>
              <th>Browser</th>
              <th>Last seen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.user.name} ({s.user.email})
                </td>
                <td>{s.ip ?? "—"}</td>
                <td>{s.userAgent ?? "—"}</td>
                <td>{s.lastSeenAt.toLocaleString("en-US")}</td>
                <td>
                  <RevokeSessionButton id={s.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
