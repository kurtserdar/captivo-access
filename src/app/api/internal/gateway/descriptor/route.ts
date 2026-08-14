import { NextRequest, NextResponse } from "next/server";
import { evaluateAccess } from "@/lib/access/evaluate";
import { getVaultCredential } from "@/lib/vault/store";
import { recordingEnabled } from "@/lib/recording/enabled";
import { resolvedWatermarkDefault } from "@/lib/settings/platform";
import { parseGuacParams, resolveGuacParams, toGuacArgs } from "@/lib/gateway/guac-params";
import { isolationEnabled } from "@/lib/isolation/enabled";
import { resolvedGuacParamDefaults } from "@/lib/settings/platform";
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

  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true, connectorId: true, recordSessions: true, clipboardMode: true, upstreamUrl: true, watermark: true, fileTransferMode: true } });
  if (!site || (site.accessMode !== "GATEWAY" && site.accessMode !== "ISOLATED")) return NextResponse.json({ error: "not_gateway" }, { status: 404 });

  const decision = await evaluateAccess(userId, siteId, new Date());
  if (!decision.allow) return NextResponse.json({ error: "forbidden", reason: decision.reason }, { status: 403 });

  if (site.accessMode === "ISOLATED") {
    if (!isolationEnabled()) return NextResponse.json({ error: "isolation_disabled" }, { status: 404 });
    // DLP watermark (live-view): vendor email + live UTC clock, rendered by KasmVNC to
    // every client. Resolve per-site override against the global default.
    const watermarkOn = site.watermark ?? (await resolvedWatermarkDefault());
    let watermarkText = "";
    if (watermarkOn) {
      const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
      const who = u?.email ?? "";
      if (who) watermarkText = who + "  %Y-%m-%d %H:%M UTC";
    }
    return NextResponse.json({
      transport: "kasm",
      navigateUrl: site.upstreamUrl ?? "",
      kasmAddr: (process.env.ISOLATED_KASM_ADDR ?? "captivo-kasm:6901").trim(),
      kasmControlAddr: (process.env.ISOLATED_KASM_CONTROL_ADDR ?? "captivo-kasm:7900").trim(),
      connectorId: site.connectorId,
      clipboardMode: site.clipboardMode,
      record: recordingEnabled() && site.recordSessions,
      watermarkText,
      fileTransferMode: site.fileTransferMode,
    });
  }

  const cred = await getVaultCredential(siteId);
  if (!cred) return NextResponse.json({ error: "no_credential" }, { status: 404 });

  const resolved = resolveGuacParams(parseGuacParams(cred.guacParams), await resolvedGuacParamDefaults());
  const params = toGuacArgs(resolved, site.clipboardMode, cred.protocol as "RDP" | "SSH" | "VNC", cred.username);

  return NextResponse.json({
    protocol: cred.protocol.toLowerCase(),
    params,
    targetHost: cred.targetHost,
    targetPort: cred.targetPort,
    username: cred.username,
    secret: cred.secret,
    secretKind: cred.secretKind,
    guacdAddress: (process.env.GUACD_ADDR ?? "captivo-guacd:4822").trim(),
    connectorId: site.connectorId,
    record: recordingEnabled() && site.recordSessions,
  });
}
