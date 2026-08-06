import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Caddy On-Demand TLS "ask" endpoint. Before issuing a certificate for a
 * hostname, Caddy calls GET /api/internal/tls-check?domain=<host>. Return 200
 * only when <host> is a configured Site, so Caddy issues certs for real vendor
 * apps and never for arbitrary hostnames. 403 otherwise.
 *
 * No secret header: Caddy's `ask` is a plain GET with only ?domain= appended
 * and cannot send DATAPLANE_SECRET. The endpoint reveals only whether a
 * hostname is a configured Site (an attacker learns the same by connecting),
 * so it carries no body and no other data.
 */
export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain")?.toLowerCase().trim();
  if (!domain) return new NextResponse(null, { status: 403 });
  const site = await db.site.findUnique({ where: { hostname: domain }, select: { id: true } });
  return new NextResponse(null, { status: site ? 200 : 403 });
}
