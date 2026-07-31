import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeHash, AUDIT_CHAIN_LOCK_KEY } from "@/lib/audit/chain";

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

  // Normalize into the shape the chain hashes over (seq/prevHash/hash filled below).
  const normalized = events.map((e) => ({
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

  const inserted = await db.$transaction(async (tx) => {
    // Serialize all audit writes so concurrent batches never race the chain head.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;

    const head = await tx.auditChainState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
      select: { lastSeq: true, lastHash: true },
    });

    let lastSeq = head.lastSeq;
    let lastHash = head.lastHash;
    const rows = normalized.map((n) => {
      const seq = lastSeq + BigInt(1);
      const prevHash = lastHash;
      const hash = computeHash(prevHash, { ...n, seq });
      lastSeq = seq;
      lastHash = hash;
      return { ...n, seq, prevHash, hash };
    });

    await tx.auditEvent.createMany({ data: rows });
    await tx.auditChainState.update({
      where: { id: "singleton" },
      data: { lastSeq, lastHash },
    });
    return rows.length;
  });

  return NextResponse.json({ inserted });
}
