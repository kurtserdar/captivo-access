import { db } from "@/lib/db";
import { buildRecordingWhere, type RecordingFilter } from "./filter";
import { scanDecryptedMatches, COMMAND_SCAN_CAP } from "./command-search";

const RECORDING_SELECT = {
  id: true,
  siteId: true,
  userId: true,
  host: true,
  startedAt: true,
  lastEventAt: true,
  eventCount: true,
  bytes: true,
  format: true,
  protocol: true,
} as const;

export interface RecordingRow {
  id: string;
  siteId: string;
  userId: string;
  host: string;
  startedAt: Date;
  lastEventAt: Date;
  eventCount: number;
  bytes: number;
  format: string;
  protocol: string | null;
}

export async function listRecordings(
  filter: RecordingFilter,
): Promise<{ rows: RecordingRow[]; total: number; tooBroad?: boolean }> {
  const baseWhere = buildRecordingWhere(filter);
  const cmd = filter.cmd?.trim();

  if (cmd && cmd.length >= 2) {
    // Phase 1: candidate recordings under the other filters. keystrokeLogging is
    // opt-in, so most recordings have no key events and are never scanned.
    const candidates = await db.sessionRecording.findMany({
      where: baseWhere,
      select: { recordingKey: true },
    });
    const candidateKeys = candidates.map((c) => c.recordingKey);
    if (candidateKeys.length === 0) return { rows: [], total: 0 };

    // Phase 2 (cap): count non-masked events; bail with a signal if too large to
    // scan cheaply, rather than degrading.
    const eventCount = await db.sessionKeyEvent.count({
      where: { recordingKey: { in: candidateKeys }, masked: false },
    });
    if (eventCount > COMMAND_SCAN_CAP) return { rows: [], total: 0, tooBroad: true };

    // Phase 3: decrypt-scan the non-masked events (masked lines never fetched).
    const events = await db.sessionKeyEvent.findMany({
      where: { recordingKey: { in: candidateKeys }, masked: false },
      select: { recordingKey: true, data: true },
    });
    const matchedKeys = scanDecryptedMatches(
      events.map((e) => ({ recordingKey: e.recordingKey, data: new Uint8Array(e.data) })),
      cmd,
    );
    if (matchedKeys.size === 0) return { rows: [], total: 0 };

    // Phase 4: list the matching recordings, still honouring the other filters.
    const where = { ...baseWhere, recordingKey: { in: [...matchedKeys] } };
    const [rows, total] = await Promise.all([
      db.sessionRecording.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: filter.offset,
        take: filter.limit,
        select: RECORDING_SELECT,
      }),
      db.sessionRecording.count({ where }),
    ]);
    return { rows, total };
  }

  const where = baseWhere;
  const [rows, total] = await Promise.all([
    db.sessionRecording.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: RECORDING_SELECT,
    }),
    db.sessionRecording.count({ where }),
  ]);
  return { rows, total };
}
