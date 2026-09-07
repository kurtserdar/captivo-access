import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { recordCronRun } from "@/lib/cron/heartbeat";
import { forEachTenant } from "@/lib/cron/for-each-tenant";
import { runAnchor, runAdminAnchor } from "@/lib/audit/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("authorization"), `Bearer ${s}`);
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await recordCronRun("audit-anchor");
  // Each chain (access/admin) is per-tenant, so the anchor read/write pair must
  // run inside each tenant's own scope — fanned out via forEachTenant.
  const results = await forEachTenant(async () => {
    // Always 200 — each run is fail-open and reports its own status; a failure
    // in one chain never blocks the other or the next run.
    const access = await runAnchor();
    const admin = await runAdminAnchor();
    return { access, admin };
  });
  // Self-host (exactly one, implicit-default result): the historical top-level
  // { access, admin } shape, unchanged. Multi-tenant fan-out: a per-tenant
  // breakdown.
  return NextResponse.json(results.length === 1 ? results[0] : { results });
}
