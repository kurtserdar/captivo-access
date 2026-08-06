import Link from "next/link";
import { requireCapability } from "@/lib/current-user";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { MarkReadButton } from "./mark-read-button";
import { MarkOneReadButton } from "./mark-one-read-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function AdminNotificationsPage() {
  await requireCapability("read_console");

  const notifications = await db.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      type: true,
      siteName: true,
      detail: true,
      createdAt: true,
      readAt: true,
    },
  });

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Site down/recovered events from the health probe.</p>
        </div>
        {unread > 0 && <MarkReadButton />}
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id} className={n.readAt ? undefined : "row-unread"}>
                  <td>
                    {n.type === "site_down" ? (
                      <span className="pill danger">Down</span>
                    ) : (
                      <span className="pill ok">Recovered</span>
                    )}
                  </td>
                  <td>
                    <Link href="/admin/sites">{n.siteName}</Link>
                  </td>
                  <td className="cell-sub">{n.detail ?? "—"}</td>
                  <td className="cell-sub">{timeAgo(n.createdAt)}</td>
                  <td>{!n.readAt && <MarkOneReadButton id={n.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
