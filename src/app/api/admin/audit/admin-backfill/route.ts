import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { backfillAdminChain } from "@/lib/audit/admin-backfill";
import { withTenantRoute } from "@/lib/tenant/request";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async () => {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await backfillAdminChain();
  return NextResponse.json(result);
});
