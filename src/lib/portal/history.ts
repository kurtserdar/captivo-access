import { db } from "@/lib/db";
import { listRecordings } from "@/lib/recording/query";

export const HISTORY_PAGE_SIZE = 20;

export interface HistoryRowJSON {
  id: string;
  name: string;
  protocol: string;
  date: string;         // ISO
  durationText: string; // "42m" / "1h 12m"
}

function durationText(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m`;
}

// A page of the given user's own session history, resource names resolved.
export async function historyPage(userId: string, offset: number, limit = HISTORY_PAGE_SIZE): Promise<HistoryRowJSON[]> {
  const { rows } = await listRecordings({ userId, limit, offset });
  const siteIds = [...new Set(rows.map((r) => r.siteId))];
  const sites = siteIds.length ? await db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(sites.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id,
    name: nameById.get(r.siteId) ?? r.host,
    protocol: r.protocol ?? "",
    date: r.startedAt.toISOString(),
    durationText: durationText(r.startedAt, r.lastEventAt),
  }));
}
