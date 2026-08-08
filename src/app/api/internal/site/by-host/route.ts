import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const host = typeof body.host === "string" ? body.host : "";
  const site = host
    ? await db.site.findUnique({
        where: { hostname: host.toLowerCase().trim() },
        select: { id: true, connectorId: true, upstreamUrl: true, insecureSkipVerify: true, recordSessions: true },
      })
    : null;
  if (!site) return NextResponse.json({ error: "no_site" }, { status: 404 });
  return NextResponse.json({
    siteId: site.id,
    connectorId: site.connectorId,
    upstreamUrl: site.upstreamUrl,
    insecureSkipVerify: site.insecureSkipVerify,
    recordSessions: site.recordSessions,
  });
}
