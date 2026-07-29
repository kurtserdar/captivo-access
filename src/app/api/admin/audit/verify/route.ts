import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { verifyChain, type StoredEvent } from "@/lib/audit/verify";

export const dynamic = "force-dynamic";

const PAGE = 1000;

export async function GET() {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Page through all events in seq order, bounding memory but building the full
  // ordered array the pure verifier expects.
  const events: StoredEvent[] = [];
  let cursorSeq: bigint | null = null;
  for (;;) {
    const where: Prisma.AuditEventWhereInput = cursorSeq === null ? {} : { seq: { gt: cursorSeq } };
    const batch = await db.auditEvent.findMany({
      where,
      orderBy: { seq: "asc" },
      take: PAGE,
      select: {
        seq: true, timestamp: true, userId: true, siteId: true, host: true,
        method: true, path: true, status: true, bytesOut: true, decision: true,
        reason: true, clientIp: true, userAgent: true, prevHash: true, hash: true,
      },
    });
    if (batch.length === 0) break;
    for (const b of batch) events.push(b as StoredEvent);
    cursorSeq = batch[batch.length - 1].seq;
    if (batch.length < PAGE) break;
  }

  return NextResponse.json(verifyChain(events));
}
