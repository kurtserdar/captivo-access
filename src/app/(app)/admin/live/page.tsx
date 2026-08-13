import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { listActiveSessions, listActiveWebSessions } from "@/lib/dataplane/client";
import { LiveTable, type LiveRow } from "./live-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live sessions" };

export default async function AdminLivePage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "read_console")) notFound();

  const [sessions, webSessions] = await Promise.all([listActiveSessions(), listActiveWebSessions()]);
  const webUserIds = webSessions.map((s) => s.userId);
  const webSiteIds = webSessions.map((s) => s.siteId);
  const userIds = [...new Set([...sessions.map((s) => s.userId), ...webUserIds])];
  const siteIds = [...new Set([...sessions.map((s) => s.siteId), ...webSiteIds])];

  const [userList, siteList, webGrants] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    siteIds.length ? db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    webSessions.length
      ? db.accessGrant.findMany({
          where: { status: "ACTIVE", userId: { in: [...new Set(webUserIds)] }, siteId: { in: [...new Set(webSiteIds)] } },
          select: { id: true, userId: true, siteId: true },
        })
      : Promise.resolve([]),
  ]);
  const users = new Map(userList.map((u) => [u.id, u]));
  const sites = new Map(siteList.map((s) => [s.id, s]));
  const grantMap = new Map(webGrants.map((g) => [g.userId + "\x1f" + g.siteId, g.id]));
  const label = (userId: string) => users.get(userId)?.name ?? users.get(userId)?.email ?? userId;

  const gatewayRows: LiveRow[] = sessions.map((s) => ({
    kind: "gateway" as const,
    sessionId: s.sessionId,
    siteName: sites.get(s.siteId)?.name ?? s.host,
    userLabel: label(s.userId),
    protocol: s.protocol,
    startedAt: s.startedAt,
    viewerCount: s.viewerCount,
    controlled: s.controlOwner !== "",
  }));
  const webRows: LiveRow[] = webSessions.map((s) => ({
    kind: "web" as const,
    siteName: sites.get(s.siteId)?.name ?? s.host,
    userLabel: label(s.userId),
    host: s.host,
    startedAt: s.startedAt,
    grantId: grantMap.get(s.userId + "\x1f" + s.siteId) ?? null,
  }));
  const rows = [...gatewayRows, ...webRows];

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Live sessions</h1>
          <p>In-progress remote-desktop and web-app sessions.</p>
        </div>
      </div>
      <LiveTable rows={rows} canTerminate={can(user!.role, "configure")} />
    </main>
  );
}
