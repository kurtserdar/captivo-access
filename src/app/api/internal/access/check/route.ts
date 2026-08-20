import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { evaluateAccess } from "@/lib/access/evaluate";
import { resolvedVendorIpAllowlist } from "@/lib/settings/platform";
import { ipAllowed } from "@/lib/net/cidr";

export const runtime = "nodejs"; // ipAllowed uses node:net

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const siteId = typeof body.siteId === "string" ? body.siteId : "";
  const clientIp = typeof body.clientIp === "string" ? body.clientIp : "";
  if (!userId || !siteId) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // Zero-Trust network gate: an active source-IP allowlist is the outer
  // condition — a granted user from a non-allowlisted network is still denied.
  // Empty allowlist = no restriction. The data-plane sends the trusted client
  // IP (rightmost X-Forwarded-For hop), so this can't be spoofed by the client.
  const allowlist = await resolvedVendorIpAllowlist();
  if (allowlist && !ipAllowed(allowlist, clientIp)) {
    return NextResponse.json({ allow: false, reason: "ip_not_allowed" });
  }

  const d = await evaluateAccess(userId, siteId, new Date());
  return NextResponse.json({ allow: d.allow, reason: d.reason });
}
