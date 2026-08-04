import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { MarkReadButton } from "./mark-read-button";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  await requireAdmin();

  const notifications = await db.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Site down/recovered events from the health probe.</p>
        </div>
        {notifications.length > 0 && <MarkReadButton />}
      </div>

      {notifications.length === 0 ? (
        <div className="empty">No notifications yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Site</th>
                <th>Detail</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id}>
                  <td>
                    {n.type === "site_down" ? (
                      <span className="pill danger">Down</span>
                    ) : (
                      <span className="pill ok">Recovered</span>
                    )}
                  </td>
                  <td>{n.siteName}</td>
                  <td className="cell-sub">{n.detail ?? "—"}</td>
                  <td className="cell-sub">{timeAgo(n.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
