import { db } from "@/lib/db";
import { buildRecordingWhere, type RecordingFilter } from "./filter";

export interface RecordingRow {
  id: string;
  siteId: string;
  userId: string;
  host: string;
  startedAt: Date;
  lastEventAt: Date;
  eventCount: number;
  bytes: number;
}

export async function listRecordings(filter: RecordingFilter): Promise<{ rows: RecordingRow[]; total: number }> {
  const where = buildRecordingWhere(filter);
  const [rows, total] = await Promise.all([
    db.sessionRecording.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: { id: true, siteId: true, userId: true, host: true, startedAt: true, lastEventAt: true, eventCount: true, bytes: true },
    }),
    db.sessionRecording.count({ where }),
  ]);
  return { rows, total };
}
