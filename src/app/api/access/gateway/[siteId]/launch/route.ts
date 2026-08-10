import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { evaluateAccess } from "@/lib/access/evaluate";
import { db } from "@/lib/db";
import { vaultEnabled } from "@/lib/vault/enabled";
import { getVaultCredential } from "@/lib/vault/store";
import { buildAuthData, type GuacAuthDoc } from "@/lib/vault/guac-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens a GATEWAY site: builds a signed guacamole-auth-json blob from the vault
// credential and redirects the vendor into an authenticated Guacamole session —
// no Guacamole login, no password entry. Falls back to the plain gateway URL
// (manual login) whenever the vault path isn't available, so it never hard-fails.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { hostname: true, name: true, accessMode: true },
  });
  if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const fallback = NextResponse.redirect(`https://${site.hostname}`);
  if (!vaultEnabled() || site.accessMode !== "GATEWAY") return fallback;

  const decision = await evaluateAccess(user.id, siteId, new Date());
  if (!decision.allow) return NextResponse.json({ error: "forbidden", reason: decision.reason }, { status: 403 });

  const cred = await getVaultCredential(siteId);
  const secretHex = (process.env.GUAC_JSON_SECRET_KEY ?? "").trim();
  if (!cred || secretHex.length !== 32) return fallback; // no credential / not configured → manual login

  const doc: GuacAuthDoc = {
    username: user.email,
    expires: Date.now() + 60_000, // short-lived
    connections: {
      [site.name]: {
        protocol: cred.protocol.toLowerCase(),
        parameters: {
          hostname: cred.targetHost,
          port: String(cred.targetPort),
          username: cred.username,
          ...(cred.secretKind === "KEY" ? { "private-key": cred.secret } : { password: cred.secret }),
          "recording-path": "/recordings",
          "recording-name": `${siteId}-${user.id}-${Date.now()}`,
          "recording-include-keys": "true",
        },
      },
    },
  };
  const data = buildAuthData(secretHex, doc);
  return NextResponse.redirect(`https://${site.hostname}/guacamole/#/?data=${encodeURIComponent(data)}`);
}
