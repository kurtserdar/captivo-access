import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { db } from "@/lib/db";
import { probeSite, probeGatewaySite } from "@/lib/connector/health";
import { classifyTransition, notifyTransition } from "@/lib/notifications";
import { recordCronRun } from "@/lib/cron/heartbeat";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("authorization"), `Bearer ${s}`);
}

const POOL = 8;

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await recordCronRun("site-health");

  const sites = await db.site.findMany({ select: { id: true, connectorId: true, upstreamUrl: true, name: true, probeOk: true } });
  // Sites with no internal address aren't misconfigured probes — they're just
  // not set up yet. Skip them rather than reporting them "unreachable".
  const toProbe = sites.filter(
    (s): s is { id: string; connectorId: string; upstreamUrl: string; name: string; probeOk: boolean | null } => !!s.upstreamUrl,
  );

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
        const transition = classifyTransition(site.probeOk, probeOk);
        if (transition) {
          // Only a down event carries a failure reason; a recovered event has
          // no meaningful detail (probeDetail is just "reachable" on success).
          const detail = transition === "site_down" ? probeDetail : null;
          await notifyTransition({ type: transition, siteId: site.id, siteName: site.name, detail });
        }
        await db.site.update({ where: { id: site.id }, data: { probedAt: now, probeOk, probeDetail, probeLatencyMs } });
      }),
    );
  }

  // GATEWAY sites have no upstreamUrl; probe their remote-desktop target
  // (VaultCredential.targetHost:targetPort) with the same TCP connect.
  const gateways = await db.site.findMany({
    where: { accessMode: "GATEWAY" },
    select: {
      id: true,
      name: true,
      probeOk: true,
      connectorId: true,
      vaultCredential: { select: { targetHost: true, targetPort: true } },
    },
  });
  const gwToProbe = gateways.filter((g) => g.vaultCredential !== null);
  for (let i = 0; i < gwToProbe.length; i += POOL) {
    const batch = gwToProbe.slice(i, i + POOL);
    await Promise.all(
      batch.map(async (site) => {
        const vc = site.vaultCredential!;
        const { probeOk, probeDetail, probeLatencyMs } = await probeGatewaySite({
          connectorId: site.connectorId,
          targetHost: vc.targetHost,
          targetPort: vc.targetPort,
        });
        if (probeOk) reachable++;
        else unreachable++;
        const transition = classifyTransition(site.probeOk, probeOk);
        if (transition) {
          const detail = transition === "site_down" ? probeDetail : null;
          await notifyTransition({ type: transition, siteId: site.id, siteName: site.name, detail });
        }
        await db.site.update({ where: { id: site.id }, data: { probedAt: now, probeOk, probeDetail, probeLatencyMs } });
      }),
    );
  }

  return NextResponse.json({
    checked: toProbe.length + gwToProbe.length,
    reachable,
    unreachable,
    skipped: sites.length - toProbe.length - gwToProbe.length,
  });
}
