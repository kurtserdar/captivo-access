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
    select: {
      connectorId: true,
      upstreamUrl: true,
      connector: { select: { status: true } },
    },
  });
  if (!site) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (site.connector.status === "REVOKED") {
    // Guards the race between a revoke and the /kick call landing on the
    // data-plane: even if the connector's yamux session is still briefly
    // alive, never proxy to a connector we've already revoked.
    return NextResponse.json({ error: "connector_revoked" });
  }
  if (!site.upstreamUrl) {
    // A Site upgraded from an older version (or not yet configured) has no
    // internal address — nothing to test until one is set.
    return NextResponse.json({ error: "no_upstream_url" });
  }

  const result = await proxyThroughConnector({
    connectorId: site.connectorId,
    upstreamUrl: site.upstreamUrl,
  });

  return NextResponse.json(result);
}
