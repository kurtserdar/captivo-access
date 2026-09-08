import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { historyPage } from "@/lib/portal/history";
import { withTenantRoute } from "@/lib/tenant/request";

export const GET = withTenantRoute(async (req: Request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = new URL(req.url).searchParams.get("offset") ?? "0";
  const offset = Math.max(0, Number.parseInt(raw, 10) || 0);
  const rows = await historyPage(user.id, offset);
  return NextResponse.json({ rows });
});
