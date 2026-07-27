import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { proxyThroughConnector } from "@/lib/connector/dataplane";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const site = await db.site.findUnique({
    where: { id },
    select: { connectorId: true, upstreamName: true },
  });
  if (!site) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await proxyThroughConnector({
    connectorId: site.connectorId,
    upstreamName: site.upstreamName,
  });

  return NextResponse.json(result);
}
