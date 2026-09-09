import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withTenantRoute } from "@/lib/tenant/request";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { managerBaseUrl } from "@/lib/url";
import { startSupportSession, supportCookieOptions, SUPPORT_COOKIE } from "@/lib/support/session";

export const dynamic = "force-dynamic";

// Tenant-host side of support access: consume the one-time token, start the
// support session, set the host-only cookie, land on the console.
export const GET = withTenantRoute(async (req: NextRequest) => {
  if (!multiTenantEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const base = managerBaseUrl(req);
  if (!token) return NextResponse.redirect(new URL("/login?error=support", base));
  const r = await startSupportSession(token, req);
  if (!r.ok) {
    console.error(`[support] handoff refused: ${r.error}`);
    return NextResponse.redirect(new URL("/login?error=support", base));
  }
  (await cookies()).set(SUPPORT_COOKIE, r.token, await supportCookieOptions());
  return NextResponse.redirect(new URL("/", base));
});
