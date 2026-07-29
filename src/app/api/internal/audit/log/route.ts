import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

interface IncomingEvent {
  timestamp?: string; userId?: string; siteId?: string;
  host?: string; method?: string; path?: string; status?: number;
  bytesOut?: number; decision?: string; reason?: string; clientIp?: string; userAgent?: string;
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { events?: IncomingEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0) return NextResponse.json({ inserted: 0 });

  const userIds = [...new Set(events.map((e) => e.userId).filter((x): x is string => !!x))];
  const siteIds = [...new Set(events.map((e) => e.siteId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const sites = siteIds.length
    ? await db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } })
    : [];
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const nameById = new Map(sites.map((s) => [s.id, s.name]));

  const rows = events.map((e) => ({
    timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
    userId: e.userId ?? null,
    userEmail: e.userId ? emailById.get(e.userId) ?? null : null,
    siteId: e.siteId ?? null,
    siteName: e.siteId ? nameById.get(e.siteId) ?? null : null,
    host: e.host ?? "",
    method: e.method ?? "",
    path: e.path ?? "",
    status: typeof e.status === "number" ? e.status : 0,
    bytesOut: BigInt(typeof e.bytesOut === "number" ? Math.max(0, Math.trunc(e.bytesOut)) : 0),
    decision: e.decision === "DENY" ? ("DENY" as const) : ("ALLOW" as const),
    reason: e.reason ?? null,
    clientIp: e.clientIp ?? null,
    userAgent: e.userAgent ?? null,
  }));
  const result = await db.auditEvent.createMany({ data: rows });
  return NextResponse.json({ inserted: result.count });
}
