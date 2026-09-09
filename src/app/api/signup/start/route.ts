import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { currentTenantId } from "@/lib/tenant/context";
import { PLATFORM_TENANT_ID } from "@/lib/tenant/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { signupEnabled, startSignup } from "@/lib/signup/flow";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async (req: NextRequest) => {
  if (currentTenantId() !== PLATFORM_TENANT_ID || !(await signupEnabled())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ip = clientIp(req.headers) ?? "unknown";
  if (!checkRateLimit(`${ip}:signup`, 5, 10 * 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await startSignup({
    name: typeof b.name === "string" ? b.name : "",
    slug: typeof b.slug === "string" ? b.slug : "",
    email: typeof b.email === "string" ? b.email : "",
    adminName: typeof b.adminName === "string" ? b.adminName : "",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "mail_failed" ? 503 : 400 });
  return NextResponse.json({ ok: true });
});
