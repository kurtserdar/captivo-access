import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";
import { parseLogoUpload } from "@/lib/site/logo";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "configure")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const hostname = typeof body.hostname === "string" ? body.hostname.trim().toLowerCase() : "";
  const upstreamUrl = typeof body.upstreamUrl === "string" ? body.upstreamUrl.trim() : "";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const insecureSkipVerify = body.insecureSkipVerify === true;
  const accessMode = body.accessMode === "GATEWAY" ? "GATEWAY" : "TRANSPARENT";
  // Gateway sites are recorded by Guacamole, not rrweb — rrweb cannot capture a
  // gateway's canvas, so recording must never be persisted as enabled for them.
  const recordSessions = accessMode === "GATEWAY" ? false : recordingEnabled() && body.recordSessions === true;

  if (!connectorId || !name || !upstreamUrl) {
    return NextResponse.json({ error: "connector_name_upstream_required" }, { status: 400 });
  }
  if (!hostname) {
    return NextResponse.json({ error: "invalid_hostname" }, { status: 400 });
  }

  let u: URL;
  try {
    u = new URL(upstreamUrl);
  } catch {
    return NextResponse.json({ error: "invalid_upstream_url" }, { status: 400 });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return NextResponse.json({ error: "invalid_upstream_url" }, { status: 400 });
  }

  const connector = await db.connector.findUnique({ where: { id: connectorId }, select: { id: true } });
  if (!connector) {
    return NextResponse.json({ error: "connector_not_found" }, { status: 400 });
  }

  const logoResult = parseLogoUpload(body.logo, body.logoType);
  if (logoResult.action === "error") {
    return NextResponse.json({ error: logoResult.error }, { status: 400 });
  }

  const site = await db.site.create({
    data: {
      connectorId, name, hostname, upstreamUrl, description, insecureSkipVerify, recordSessions, accessMode,
      ...(logoResult.action === "set" ? { logo: logoResult.data, logoType: logoResult.type } : {}),
    },
    select: { id: true },
  });

  return NextResponse.json({ id: site.id });
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
