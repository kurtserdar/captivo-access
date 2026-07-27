import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const connectorId = typeof body.connectorId === "string" ? body.connectorId : "";
  const status = body.status === "ONLINE" || body.status === "OFFLINE" ? body.status : null;
  if (!connectorId || !status) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  await db.connector.update({
    where: { id: connectorId },
    data: {
      status,
      lastSeenAt: new Date(),
      ...(typeof body.remoteAddr === "string" ? { remoteAddr: body.remoteAddr } : {}),
      ...(typeof body.version === "string" ? { version: body.version } : {}),
    },
  }).catch(() => {}); // connector may have been deleted; ignore
  return NextResponse.json({ ok: true });
}
