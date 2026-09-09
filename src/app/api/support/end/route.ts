import { NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { endSupportSession } from "@/lib/support/session";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async () => {
  const ended = await endSupportSession();
  return NextResponse.json({ ok: true, ended });
});
