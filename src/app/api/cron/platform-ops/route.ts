import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { withTenant } from "@/lib/tenant/scope";
import { PLATFORM_TENANT_ID } from "@/lib/tenant/constants";
import { recordCronRun } from "@/lib/cron/heartbeat";
import { runPlatformOps } from "@/lib/platform/ops";

export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("authorization"), `Bearer ${s}`);
}

// Daily platform maintenance. No-op on self-host (no platform tenant).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!multiTenantEnabled()) return NextResponse.json({ ok: true, skipped: "single_tenant" });
  const result = await withTenant(PLATFORM_TENANT_ID, async () => {
    await recordCronRun("platform-ops");
    return runPlatformOps();
  });
  return NextResponse.json({ ok: true, ...result });
}
