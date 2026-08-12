import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { encrypt } from "@/lib/crypto";
import type { Prisma } from "@/generated/prisma/client";
import { validateSiteInput } from "@/lib/site/validate";
import { parseLogoUpload } from "@/lib/site/logo";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "configure")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateSiteInput(body, { nativeGateway: nativeGatewayEnabled(), requireSecret: true, recordingEnabled: recordingEnabled() });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.error === "native_gateway_disabled" ? 403 : 400 });

  const connector = await db.connector.findUnique({ where: { id: v.connectorId }, select: { id: true } });
  if (!connector) {
    return NextResponse.json({ error: "connector_not_found" }, { status: 400 });
  }

  const logoResult = parseLogoUpload(body.logo, body.logoType);
  if (logoResult.action === "error") {
    return NextResponse.json({ error: logoResult.error }, { status: 400 });
  }
  const logoData = logoResult.action === "set" ? { logo: logoResult.data, logoType: logoResult.type } : {};

  if (v.mode === "TRANSPARENT") {
    const site = await db.site.create({
      data: {
        connectorId: v.connectorId, name: v.name, hostname: v.hostname, upstreamUrl: v.upstreamUrl, description: v.description,
        insecureSkipVerify: v.insecureSkipVerify, recordSessions: v.recordSessions, clipboardMode: v.clipboardMode, accessMode: "TRANSPARENT", ...logoData,
      },
      select: { id: true },
    });
    await recordAdminAction({
      actor: { id: admin.id, email: admin.email },
      action: "resource.create",
      targetType: "resource", targetId: site.id,
      summary: `Created resource "${v.name}"`,
      clientIp: clientIp(req.headers) ?? null,
    });
    return NextResponse.json({ id: site.id });
  }

  // GATEWAY (remote desktop): the site (null hostname/upstream) + its credential, atomically.
  const encSecret = encrypt(v.secret as string);
  const id = await db.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: { connectorId: v.connectorId, name: v.name, hostname: null, upstreamUrl: null, description: v.description, recordSessions: v.recordSessions, accessMode: "GATEWAY", ...logoData },
      select: { id: true },
    });
    await tx.vaultCredential.create({
      data: { siteId: site.id, protocol: v.protocol, targetHost: v.targetHost, targetPort: v.targetPort, username: v.username, secret: encSecret, secretKind: "PASSWORD", guacParams: v.guacParams as Prisma.InputJsonValue },
    });
    return site.id;
  });
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "resource.create",
    targetType: "resource", targetId: id,
    summary: `Created resource "${v.name}"`,
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ id });
}

export async function GET() {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "read_console")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sites = await db.site.findMany({
    select: {
      id: true,
      name: true,
      hostname: true,
      upstreamUrl: true,
      description: true,
      connectorId: true,
      connector: { select: { name: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ sites });
}
