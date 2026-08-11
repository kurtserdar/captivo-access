import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/dataplane/client";
import { LiveTable, type LiveRow } from "./live-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live sessions" };

export default async function AdminLivePage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "read_console")) notFound();

  const sessions = await listActiveSessions();
  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const siteIds = [...new Set(sessions.map((s) => s.siteId))];
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]),
  );
  const sites = new Map(
    (await db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } })).map((s) => [s.id, s]),
  );

  const rows: LiveRow[] = sessions.map((s) => ({
    sessionId: s.sessionId,
    siteName: sites.get(s.siteId)?.name ?? s.host,
    userLabel: users.get(s.userId)?.name ?? users.get(s.userId)?.email ?? s.userId,
    protocol: s.protocol,
    startedAt: s.startedAt,
    viewerCount: s.viewerCount,
    controlled: s.controlOwner !== "",
  }));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Live sessions</h1>
          <p>Watch in-progress remote-desktop sessions in real time.</p>
        </div>
      </div>
      <LiveTable rows={rows} />
    </main>
  );
}
