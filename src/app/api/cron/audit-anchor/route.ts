import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/cron/heartbeat";
import { runAnchor, runAdminAnchor } from "@/lib/audit/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await recordCronRun("audit-anchor");
  // Always 200 — each run is fail-open and reports its own status; a failure in
  // one chain never blocks the other or the next run.
  const access = await runAnchor();
  const admin = await runAdminAnchor();
  return NextResponse.json({ access, admin });
}
