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
  // Never resurrect a REVOKED connector: the data-plane's automatic ONLINE/OFFLINE
  // reports must not overwrite an admin revocation (otherwise an OFFLINE report on
  // session teardown would clear REVOKED and let the connector re-authenticate).
  // updateMany with a status guard also no-ops safely if the connector was deleted.
  await db.connector.updateMany({
    where: { id: connectorId, status: { not: "REVOKED" } },
    data: {
      status,
      lastSeenAt: new Date(),
      ...(typeof body.remoteAddr === "string" ? { remoteAddr: body.remoteAddr } : {}),
      ...(typeof body.version === "string" ? { version: body.version } : {}),
    },
  });
  const c = await db.connector.findUnique({ where: { id: connectorId }, select: { egressPolicy: true, logLevel: true } });
  return NextResponse.json({ ok: true, egressPolicy: c?.egressPolicy ?? "", logLevel: c?.logLevel ?? "info" });
}
