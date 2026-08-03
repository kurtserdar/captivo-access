import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { MarkReadButton } from "./mark-read-button";

export const dynamic = "force-dynamic";

function timeAgo(d: Date): string {
  const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default async function AdminNotificationsPage() {
  await requireAdmin();

  const notifications = await db.notification.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Site down/recovered events from the health probe.</p>
        </div>
        <MarkReadButton />
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
