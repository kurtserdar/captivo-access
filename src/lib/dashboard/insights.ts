import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/dataplane/client";

export interface TrendDay { date: string; allow: number; deny: number }
export interface Labeled { label: string; count: number }
export interface IpFlag { userEmail: string; ipCount: number }

export interface AuditRow {
  timestamp: Date;
  decision: "ALLOW" | "DENY";
  siteName: string | null;
  siteId: string | null;
  userEmail: string | null;
  clientIp: string | null;
  reason: string | null;
}

export const IP_FLAG_THRESHOLD = 3;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// 30 zero-filled UTC days, oldest→newest, allow/deny counted per day.
export function buildTrend(rows: AuditRow[], now: Date, days = 30): TrendDay[] {
  const keys: string[] = [];
  const counts = new Map<string, { allow: number; deny: number }>();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    const k = dayKey(d);
    keys.push(k);
    counts.set(k, { allow: 0, deny: 0 });
  }
  for (const r of rows) {
    const c = counts.get(dayKey(r.timestamp));
    if (!c) continue;
    if (r.decision === "ALLOW") c.allow++;
    else c.deny++;
  }
  return keys.map((k) => ({ date: k, allow: counts.get(k)!.allow, deny: counts.get(k)!.deny }));
}

// 7×24 counts by UTC weekday (0=Sun) × hour, plus the busiest cell.
export function buildHeatmap(rows: AuditRow[]): { grid: number[][]; max: number } {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const r of rows) {
    const v = ++grid[r.timestamp.getUTCDay()][r.timestamp.getUTCHours()];
    if (v > max) max = v;
  }
  return { grid, max };
}

// ALLOW-only counts by a label field, nulls skipped, desc, top `limit`.
export function topBy(rows: AuditRow[], field: "siteName" | "userEmail", limit: number, decision: "ALLOW" | "DENY" = "ALLOW"): Labeled[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.decision !== decision) continue;
    const label = r[field];
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// DENY-only reason breakdown (null → "unspecified"), total + top `limit`.
export function denyReasons(rows: AuditRow[], limit: number): { total: number; reasons: Labeled[] } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.decision !== "DENY") continue;
    total++;
    const reason = r.reason ?? "unspecified";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const reasons = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { total, reasons };
}

// Vendors seen from >= `threshold` distinct client IPs, desc by IP count.
export function ipFlags(rows: AuditRow[], threshold: number): IpFlag[] {
  const byUser = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.userEmail || !r.clientIp) continue;
    let set = byUser.get(r.userEmail);
    if (!set) {
      set = new Set();
      byUser.set(r.userEmail, set);
    }
    set.add(r.clientIp);
  }
  return [...byUser.entries()]
    .map(([userEmail, ips]) => ({ userEmail, ipCount: ips.size }))
    .filter((f) => f.ipCount >= threshold)
    .sort((a, b) => b.ipCount - a.ipCount);
}

// Distinct ALLOW vendors over the window + a 30-day daily-distinct series (UTC, oldest→newest).
export function activeVendors(rows: AuditRow[], now: Date, days = 30): { count: number; series: number[] } {
  const keys: string[] = [];
  const perDay = new Map<string, Set<string>>();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    const k = dayKey(d);
    keys.push(k);
    perDay.set(k, new Set());
  }
  const all = new Set<string>();
  for (const r of rows) {
    if (r.decision !== "ALLOW" || !r.userEmail) continue;
    all.add(r.userEmail);
    const set = perDay.get(dayKey(r.timestamp));
    if (set) set.add(r.userEmail);
  }
  return { count: all.size, series: keys.map((k) => perDay.get(k)!.size) };
}

// ALLOW events bucketed web/remote via a siteId→type map; null/unmatched skipped.
export function typeMix(rows: AuditRow[], siteType: Map<string, "web" | "remote">): { web: number; remote: number } {
  let web = 0, remote = 0;
  for (const r of rows) {
    if (r.decision !== "ALLOW" || !r.siteId) continue;
    const t = siteType.get(r.siteId);
    if (t === "web") web++;
    else if (t === "remote") remote++;
  }
  return { web, remote };
}

// Recording volume in the window: count, total hours, average minutes.
export function sessionStats(recs: { startedAt: Date; lastEventAt: Date }[]): { recordings: number; totalHours: number; avgMinutes: number } {
  if (recs.length === 0) return { recordings: 0, totalHours: 0, avgMinutes: 0 };
  let totalMs = 0;
  for (const r of recs) totalMs += Math.max(0, r.lastEventAt.getTime() - r.startedAt.getTime());
  return {
    recordings: recs.length,
    totalHours: Math.round(totalMs / 3_600_000),
    avgMinutes: Math.round(totalMs / recs.length / 60_000),
  };
}

export interface Insights {
  trend: TrendDay[];
  heatmap: { grid: number[][]; max: number };
  topResources: Labeled[];
  topVendors: Labeled[];
  deny: { total: number; reasons: Labeled[] };
  ipFlags: IpFlag[];
  expiring: { count: number; soonest: { userEmail: string; siteName: string; endsAt: string }[] };
  activeSessions: { count: number; longestStartedAt: string | null };
  activeVendors: { count: number; series: number[] };
  typeMix: { web: number; remote: number };
  sessionStats: { recordings: number; totalHours: number; avgMinutes: number };
  topDenied: Labeled[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getInsights(now = new Date()): Promise<Insights> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const in7d = new Date(now.getTime() + 7 * DAY_MS);
  const expiringWhere = { status: "ACTIVE" as const, endsAt: { gte: now, lte: in7d } };

  const [rows, expiringRows, expiringCount, active, sites, recordings] = await Promise.all([
    db.auditEvent.findMany({
      where: { timestamp: { gte: since } },
      select: { timestamp: true, decision: true, siteName: true, siteId: true, userEmail: true, clientIp: true, reason: true },
    }),
    db.accessGrant.findMany({
      where: expiringWhere,
      select: { endsAt: true, user: { select: { email: true } }, site: { select: { name: true } } },
      orderBy: { endsAt: "asc" },
      take: 5,
    }),
    db.accessGrant.count({ where: expiringWhere }),
    listActiveSessions(),
    db.site.findMany({ select: { id: true, accessMode: true } }),
    db.sessionRecording.findMany({ where: { startedAt: { gte: since } }, select: { startedAt: true, lastEventAt: true } }),
  ]);

  // `rows` already matches AuditRow (decision is the AuditDecision "ALLOW"|"DENY").
  const auditRows: AuditRow[] = rows;
  const siteType = new Map<string, "web" | "remote">(
    sites.map((s) => [s.id, s.accessMode === "GATEWAY" ? "remote" : "web"] as const),
  );
  const longestStartedAt = active.length ? [...active].map((a) => a.startedAt).sort()[0] : null;

  return {
    trend: buildTrend(auditRows, now),
    heatmap: buildHeatmap(auditRows),
    topResources: topBy(auditRows, "siteName", 5),
    topVendors: topBy(auditRows, "userEmail", 5),
    deny: denyReasons(auditRows, 5),
    ipFlags: ipFlags(auditRows, IP_FLAG_THRESHOLD),
    expiring: {
      count: expiringCount,
      soonest: expiringRows.map((g) => ({
        userEmail: g.user.email ?? "—",
        siteName: g.site.name,
        endsAt: (g.endsAt as Date).toISOString(),
      })),
    },
    activeSessions: { count: active.length, longestStartedAt },
    activeVendors: activeVendors(auditRows, now),
    typeMix: typeMix(auditRows, siteType),
    sessionStats: sessionStats(recordings),
    topDenied: topBy(auditRows, "userEmail", 3, "DENY"),
  };
}
