import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { currentTenantId } from "@/lib/tenant/context";
import { PLATFORM_TENANT_ID } from "@/lib/tenant/constants";
import { managerBaseUrl } from "@/lib/url";
import { signupEnabled, completeSignup } from "@/lib/signup/flow";

export const dynamic = "force-dynamic";

// The emailed confirmation link: creates the trial tenant and lands on its invite.
export const GET = withTenantRoute(async (req: NextRequest) => {
  if (currentTenantId() !== PLATFORM_TENANT_ID || !(await signupEnabled())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const base = managerBaseUrl(req);
  const r = await completeSignup(req.nextUrl.searchParams.get("t") ?? "");
  if (!r.ok) return NextResponse.redirect(new URL(`/signup?error=${encodeURIComponent(r.error)}`, base));
  return NextResponse.redirect(r.inviteUrl);
});
