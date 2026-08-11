import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { encrypt } from "@/lib/crypto";
import { validateSiteInput } from "@/lib/site/validate";
import { parseLogoUpload } from "@/lib/site/logo";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateSiteInput(body, { nativeGateway: nativeGatewayEnabled(), requireSecret: false, recordingEnabled: recordingEnabled() });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.error === "native_gateway_disabled" ? 403 : 400 });

  const connector = await db.connector.findUnique({ where: { id: v.connectorId }, select: { id: true } });
  if (!connector) return NextResponse.json({ error: "connector_not_found" }, { status: 400 });

  const existing = await db.site.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const logoResult = parseLogoUpload(body.logo, body.logoType);
  if (logoResult.action === "error") return NextResponse.json({ error: logoResult.error }, { status: 400 });
  const logoData =
    logoResult.action === "set" ? { logo: logoResult.data, logoType: logoResult.type }
    : logoResult.action === "clear" ? { logo: null, logoType: null }
    : {};

  if (v.mode === "TRANSPARENT") {
    try {
      await db.site.update({ where: { id }, data: { connectorId: v.connectorId, name: v.name, hostname: v.hostname, upstreamUrl: v.upstreamUrl, description: v.description, insecureSkipVerify: v.insecureSkipVerify, recordSessions: v.recordSessions, clipboardMode: v.clipboardMode, accessMode: "TRANSPARENT", ...logoData } });
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "hostname_taken" }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
  }

  // GATEWAY update: a first-time credential must include a secret.
  const hadVault = (await db.vaultCredential.count({ where: { siteId: id } })) > 0;
  if (!hadVault && !v.secret) return NextResponse.json({ error: "remote_desktop_fields_required" }, { status: 400 });

  const secretUpdate = v.secret ? { secret: encrypt(v.secret) } : {};
  await db.$transaction(async (tx) => {
    await tx.site.update({ where: { id }, data: { connectorId: v.connectorId, name: v.name, hostname: null, upstreamUrl: null, description: v.description, recordSessions: v.recordSessions, accessMode: "GATEWAY", ...logoData } });
    await tx.vaultCredential.upsert({
      where: { siteId: id },
      create: { siteId: id, protocol: v.protocol, targetHost: v.targetHost, targetPort: v.targetPort, username: v.username, secret: encrypt(v.secret ?? ""), secretKind: "PASSWORD" },
      update: { protocol: v.protocol, targetHost: v.targetHost, targetPort: v.targetPort, username: v.username, ...secretUpdate },
    });
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const existing = await db.site.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await db.site.delete({ where: { id } }); // cascades the Site's AccessGrant rows
  return NextResponse.json({ ok: true });
}
