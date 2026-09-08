import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getWatchStatus } from "@/lib/dataplane/client";
import { withTenantRoute } from "@/lib/tenant/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async (_req: Request, { params }: { params: Promise<{ siteId: string }> }) => {
  const user = await requireUser();
  const { siteId } = await params;
  const status = await getWatchStatus(user.id, siteId);
  return NextResponse.json(status);
});
