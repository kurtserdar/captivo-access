import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const upstreamName = typeof body.upstreamName === "string" ? body.upstreamName.trim() : "";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  if (!connectorId || !name || !upstreamName) {
    return NextResponse.json({ error: "connector_name_upstream_required" }, { status: 400 });
  }

  const connector = await db.connector.findUnique({ where: { id: connectorId }, select: { id: true } });
  if (!connector) {
    return NextResponse.json({ error: "connector_not_found" }, { status: 400 });
  }

  const site = await db.site.create({
    data: { connectorId, name, upstreamName, description },
    select: { id: true },
  });

  return NextResponse.json({ id: site.id });
}

export async function GET() {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sites = await db.site.findMany({
    select: {
      id: true,
      name: true,
      upstreamName: true,
      description: true,
      connectorId: true,
      connector: { select: { name: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ sites });
}
