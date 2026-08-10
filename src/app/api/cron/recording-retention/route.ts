import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolvedRecordingRetentionDays } from "@/lib/settings/platform";
import { appendAuditEvents } from "@/lib/audit/append";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

// Deletes session recordings older than the configured retention window
// (Policy → Recording retention). RecordingChunk rows cascade on the parent
// delete. Disabled (no-op) when retention is 0/unset. Fails closed without a
// valid CRON_SECRET. Intended to run daily.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const days = await resolvedRecordingRetentionDays();
  if (days <= 0) return NextResponse.json({ deleted: 0, note: "retention_disabled" });

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await db.sessionRecording.deleteMany({ where: { startedAt: { lt: cutoff } } });

  if (result.count > 0) {
    // Record the automated deletion in the tamper-evident chain (system actor:
    // no userId/siteId). Best-effort — the deletion is the primary action.
    try {
      await appendAuditEvents([
        {
          host: "manager",
          method: "DELETE",
          path: "/api/cron/recording-retention",
          status: 200,
          decision: "ALLOW",
          reason: `Recording retention: deleted ${result.count} session recording(s) older than ${days} days`,
        },
      ]);
    } catch (err) {
      console.error("[recording-retention] audit append failed:", err);
    }
  }

  return NextResponse.json({ deleted: result.count });
}
