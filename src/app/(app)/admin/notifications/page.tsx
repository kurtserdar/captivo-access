import { requireCapability } from "@/lib/current-user";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { MarkReadButton } from "./mark-read-button";
import { NotificationsView, type NotificationRow } from "./notifications-view";

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

  const rows: NotificationRow[] = notifications.map((n) => ({
    id: n.id,
    type: n.type,
    siteName: n.siteName ?? "—",
    detail: n.detail,
    when: timeAgo(n.createdAt),
    read: Boolean(n.readAt),
  }));

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
        <NotificationsView rows={rows} />
      )}
    </main>
  );
}
