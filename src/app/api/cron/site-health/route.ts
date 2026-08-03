import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { probeSite } from "@/lib/connector/health";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

const POOL = 8;

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sites = await db.site.findMany({ select: { id: true, connectorId: true, upstreamUrl: true } });
  // Sites with no internal address aren't misconfigured probes — they're just
  // not set up yet. Skip them rather than reporting them "unreachable".
  const toProbe = sites.filter((s): s is { id: string; connectorId: string; upstreamUrl: string } => !!s.upstreamUrl);
  const skipped = sites.length - toProbe.length;

  let reachable = 0;
  let unreachable = 0;
  const now = new Date();
  // Bounded concurrency so a large site list stays fast without hammering.
  for (let i = 0; i < toProbe.length; i += POOL) {
    const batch = toProbe.slice(i, i + POOL);
    await Promise.all(
      batch.map(async (site) => {
        const { probeOk, probeDetail, probeLatencyMs } = await probeSite(site);
        if (probeOk) reachable++;
        else unreachable++;
        await db.site.update({ where: { id: site.id }, data: { probedAt: now, probeOk, probeDetail, probeLatencyMs } });
      }),
    );
  }

  return NextResponse.json({ checked: toProbe.length, reachable, unreachable, skipped });
}
