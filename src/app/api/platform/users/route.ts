import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { findUsers } from "@/lib/platform/sql";

export const dynamic = "force-dynamic";

// Cross-tenant user lookup by email (substring). Platform admins only.
export const GET = withTenantRoute(async (req: NextRequest) => {
  await requirePlatformAdmin();
  const email = req.nextUrl.searchParams.get("email") ?? "";
  const users = await findUsers(email);
  return NextResponse.json({ users: users.map((u) => ({ ...u, createdAt: new Date(u.createdAt).toISOString() })) });
});
