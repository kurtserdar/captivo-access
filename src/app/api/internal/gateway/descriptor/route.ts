import { NextRequest, NextResponse } from "next/server";
import { evaluateAccess } from "@/lib/access/evaluate";
import { getVaultCredential } from "@/lib/vault/store";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dpAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

// The data-plane guac-tunnel calls this per session: it authorizes (grant) and
// returns the decrypted connection descriptor to inject into the guacd handshake.
// The plaintext secret leaves the manager only over this DATAPLANE_SECRET-gated,
// internal-only channel.
export async function POST(req: NextRequest) {
  if (!dpAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof b.userId === "string" ? b.userId : "";
  const siteId = typeof b.siteId === "string" ? b.siteId : "";
  if (!userId || !siteId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true, connectorId: true } });
  if (!site || site.accessMode !== "GATEWAY") return NextResponse.json({ error: "not_gateway" }, { status: 404 });

  const decision = await evaluateAccess(userId, siteId, new Date());
  if (!decision.allow) return NextResponse.json({ error: "forbidden", reason: decision.reason }, { status: 403 });

  const cred = await getVaultCredential(siteId);
  if (!cred) return NextResponse.json({ error: "no_credential" }, { status: 404 });

  return NextResponse.json({
    protocol: cred.protocol.toLowerCase(),
    targetHost: cred.targetHost,
    targetPort: cred.targetPort,
    username: cred.username,
    secret: cred.secret,
    secretKind: cred.secretKind,
    guacdAddress: (process.env.GUACD_ADDR ?? "guacd:4822").trim(),
    connectorId: site.connectorId,
  });
}
