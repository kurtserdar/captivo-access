import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolvedAuditRetentionDays } from "@/lib/settings/platform";
import { recordCronRun } from "@/lib/cron/heartbeat";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await recordCronRun("audit-retention");
  // Retention days come from PlatformSettings (UI), falling back to the
  // AUDIT_RETENTION_DAYS env then 730. resolvedAuditRetentionDays already
  // guards against the empty/NaN footgun (which would purge everything).
  const retentionDays = await resolvedAuditRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  // Delete a seq-contiguous PREFIX, not a raw timestamp slice: seq (ingest order)
  // and timestamp (event time) can diverge for delayed batches, and deleting an
  // interior seq would punch a hole the tamper-evidence verifier reads as tampering.
  const boundary = await db.auditEvent.aggregate({
    where: { timestamp: { lt: cutoff } },
    _max: { seq: true },
  });
  const cutoffSeq = boundary._max.seq;
  const result = cutoffSeq === null
    ? { count: 0 }
    : await db.auditEvent.deleteMany({ where: { seq: { lte: cutoffSeq } } });
  return NextResponse.json({ deleted: result.count });
}
