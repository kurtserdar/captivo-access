import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { RevokeSessionButton } from "./revoke-session-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sessions" };

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
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p>All currently active (non-expired) sessions.</p>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="empty">No active sessions.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
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
                  <td className="cell-sub">{s.ip ?? "—"}</td>
                  <td className="cell-sub">{s.userAgent ?? "—"}</td>
                  <td className="cell-sub">{s.lastSeenAt.toLocaleString("en-US")}</td>
                  <td>
                    <RevokeSessionButton id={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
