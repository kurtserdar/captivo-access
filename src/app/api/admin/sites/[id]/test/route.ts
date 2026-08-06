import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { proxyThroughConnector } from "@/lib/connector/dataplane";
import { probeSite } from "@/lib/connector/health";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "configure")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const site = await db.site.findUnique({
    where: { id },
    select: {
      connectorId: true,
      upstreamUrl: true,
      insecureSkipVerify: true,
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
    insecureSkipVerify: site.insecureSkipVerify,
  });

  // Refresh the persisted Health column with a fresh probe so the row pill
  // agrees with this manual test instead of lagging until the hourly cron.
  const probe = await probeSite({ connectorId: site.connectorId, upstreamUrl: site.upstreamUrl });
  await db.site.update({
    where: { id },
    data: { probedAt: new Date(), probeOk: probe.probeOk, probeDetail: probe.probeDetail, probeLatencyMs: probe.probeLatencyMs },
  });

  return NextResponse.json(result);
}
