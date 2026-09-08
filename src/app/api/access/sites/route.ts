import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { listSitesForRequest } from "@/lib/access/grants";
import { withTenantRoute } from "@/lib/tenant/request";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sites = await listSitesForRequest(user.id);
  return NextResponse.json({ sites });
});
