import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/dataplane/client";
import { countPendingGrants, listPendingGrants } from "@/lib/access/grants";
import { getRecentActivity } from "@/lib/dashboard/stats";
import { recordingEnabled } from "@/lib/recording/enabled";

export type ConsoleAuditRow = Awaited<ReturnType<typeof getRecentActivity>>[number];

export interface ConsoleKpis { grants: number; live: number; pending: number; expiring24h: number; recordings7d: number }
export interface LiveCard { sessionId: string; protocol: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number }
export interface PendingCard { id: string; userLabel: string; siteName: string; detail: string }
export interface ExpiringRow { id: string; userLabel: string; siteName: string; endsAt: string }
export interface ConnectorRow { id: string; name: string; online: boolean }
export interface ConsoleData {
  kpis: ConsoleKpis;
  live: LiveCard[];
  pending: PendingCard[];
  expiring: ExpiringRow[];
  connectors: ConnectorRow[];
  audit: ConsoleAuditRow[];
}

// Read-only snapshot for the security console home. Reuses existing helpers;
// listActiveSessions() already fails soft to [] when the data-plane is down.
export async function getConsoleData(): Promise<ConsoleData> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const recEnabled = recordingEnabled();

  const [grants, pending, expiring24h, recordings7d, sessions, pendingRows, expiringRows, connectors, audit] = await Promise.all([
    db.accessGrant.count({ where: { status: "ACTIVE" } }),
    countPendingGrants(),
    db.accessGrant.count({ where: { status: "ACTIVE", endsAt: { gt: now, lte: in24h } } }),
    db.sessionRecording.count({ where: { startedAt: { gte: weekAgo } } }),
    listActiveSessions(),
    listPendingGrants(),
    db.accessGrant.findMany({
      where: { status: "ACTIVE", endsAt: { gt: now, lte: in24h } },
      orderBy: { endsAt: "asc" }, take: 6,
      select: { id: true, endsAt: true, user: { select: { name: true, email: true } }, site: { select: { name: true } } },
    }),
    db.connector.findMany({ where: { status: { not: "REVOKED" } }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    getRecentActivity(6),
  ]);

  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const siteIds = [...new Set(sessions.map((s) => s.siteId))];
  const [users, sites] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    recEnabled && siteIds.length ? db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, recordSessions: true } }) : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u.name || u.email]));
  const recMap = new Map(sites.map((s) => [s.id, s.recordSessions]));

  const live: LiveCard[] = sessions.map((s) => ({
    sessionId: s.sessionId, protocol: s.protocol, host: s.host,
    userLabel: userMap.get(s.userId) ?? "unknown", startedAt: s.startedAt,
    recorded: recEnabled && (recMap.get(s.siteId) ?? false), viewerCount: s.viewerCount,
  }));

  return {
    kpis: { grants, live: sessions.length, pending, expiring24h, recordings7d },
    live,
    pending: pendingRows.map((p) => ({ id: p.id, userLabel: p.user.name || p.user.email, siteName: p.site.name, detail: p.note ?? "" })),
    expiring: expiringRows.map((e) => ({ id: e.id, userLabel: e.user.name || e.user.email, siteName: e.site.name, endsAt: (e.endsAt as Date).toISOString() })),
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, online: c.status === "ONLINE" })),
    audit,
  };
}
