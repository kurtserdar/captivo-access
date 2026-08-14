import { db } from "@/lib/db";

export type ActivityTone = "ok" | "deny" | "info" | "muted";

// One line in the console's activity stream. `kind` is the event-type slug shown as
// the badge (e.g. "access.allow", "grant.approve", "rec.saved"); `text` is the
// human description.
export interface ActivityItem {
  id: string;
  at: Date;
  kind: string;
  text: string;
  tone: ActivityTone;
}

// Pure: merge several event streams into one reverse-chronological feed, capped at
// `limit`. Kept separate so the ordering is unit-testable without a database.
export function mergeActivity(sources: ActivityItem[][], limit: number): ActivityItem[] {
  return sources
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

// A unified activity feed: access allow/deny (AuditEvent) + admin actions like grant
// approve/revoke (AdminAuditEvent) + saved session recordings, newest first. Each
// source is capped at `limit` before merging so one busy stream can't crowd out the
// others' recency.
export async function getActivityFeed(limit = 8): Promise<ActivityItem[]> {
  const [access, admin, recs] = await Promise.all([
    db.auditEvent.findMany({
      orderBy: { timestamp: "desc" }, take: limit,
      select: { id: true, timestamp: true, decision: true, userEmail: true, siteName: true, host: true },
    }),
    db.adminAuditEvent.findMany({
      orderBy: { timestamp: "desc" }, take: limit,
      select: { id: true, timestamp: true, actorEmail: true, action: true, summary: true },
    }),
    db.sessionRecording.findMany({
      orderBy: { lastEventAt: "desc" }, take: limit,
      select: { id: true, lastEventAt: true, host: true },
    }),
  ]);

  const accessItems: ActivityItem[] = access.map((e) => ({
    id: `a:${e.id}`,
    at: e.timestamp,
    kind: e.decision === "ALLOW" ? "access.allow" : "access.deny",
    text: `${e.userEmail ?? "someone"} ${e.decision === "ALLOW" ? "accessed" : "blocked at"} ${e.siteName ?? e.host}`,
    tone: e.decision === "ALLOW" ? "ok" : "deny",
  }));

  const adminItems: ActivityItem[] = admin.map((e) => ({
    id: `m:${e.id}`,
    at: e.timestamp,
    kind: e.action,
    text: e.actorEmail ? `${e.actorEmail} · ${e.summary}` : e.summary,
    tone: /revoke|deny|delete|disable/.test(e.action) ? "deny" : "info",
  }));

  const recItems: ActivityItem[] = recs.map((r) => ({
    id: `r:${r.id}`,
    at: r.lastEventAt,
    kind: "rec.saved",
    text: `session recording · ${r.host}`,
    tone: "muted",
  }));

  return mergeActivity([accessItems, adminItems, recItems], limit);
}
