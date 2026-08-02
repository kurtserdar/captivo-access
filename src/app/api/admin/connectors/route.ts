import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { createPairing } from "@/lib/connector/enrollment";
import { kickConnector } from "@/lib/connector/dataplane";
import { managerBaseUrl, connectorTunnelUrl } from "@/lib/url";

function buildInstallCommand(code: string, managerUrl: string, tunnelUrl: string): string {
  return (
    "docker run -d --name access-connector --restart unless-stopped " +
    `-e MANAGER_URL=${managerUrl} ` +
    `-e DATAPLANE_URL=${tunnelUrl} ` +
    `-e PAIR_CODE=${code} ` +
    "-v access_connector_data:/data " +
    "ghcr.io/kurtserdar/captivo-access-connector:latest"
  );
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const { code } = await createPairing(name);
  const managerUrl = managerBaseUrl(req);
  const installCommand = buildInstallCommand(code, managerUrl, connectorTunnelUrl());
  // A connector runs on a different machine, so a localhost manager URL (seen
  // when the admin browses via an SSH tunnel) won't be reachable from it.
  const managerUrlIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(managerUrl);

  return NextResponse.json({ code, installCommand, managerUrlIsLocal });
}

export async function GET() {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const connectors = await db.connector.findMany({
    select: { id: true, name: true, status: true, lastSeenAt: true, version: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ connectors });
}

export async function DELETE(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  const target = await db.connector.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db.connector.update({ where: { id }, data: { status: "REVOKED" } });
  await kickConnector(id);
  return NextResponse.json({ ok: true });
}
