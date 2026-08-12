import { db } from "@/lib/db";
import { computeAdminHash, ADMIN_AUDIT_CHAIN_LOCK_KEY, ADMIN_CHAIN_ID } from "./admin-chain";

// One-time, idempotent: chains every AdminAuditEvent row that has no seq yet,
// in insertion order, continuing from the current admin head. No-op if none.
export async function backfillAdminChain(): Promise<{ backfilled: number }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_AUDIT_CHAIN_LOCK_KEY})`;
    const pending = await tx.adminAuditEvent.findMany({
      where: { seq: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, timestamp: true, actorId: true, actorEmail: true, action: true, targetType: true, targetId: true, summary: true, metadata: true, clientIp: true },
    });
    if (pending.length === 0) return { backfilled: 0 };
    const head = await tx.auditChainState.upsert({
      where: { id: ADMIN_CHAIN_ID }, create: { id: ADMIN_CHAIN_ID }, update: {},
      select: { lastSeq: true, lastHash: true },
    });
    let lastSeq = head.lastSeq;
    let lastHash = head.lastHash;
    for (const r of pending) {
      const seq = lastSeq + 1n;
      const hash = computeAdminHash(lastHash, {
        seq, timestamp: r.timestamp, actorId: r.actorId, actorEmail: r.actorEmail,
        action: r.action, targetType: r.targetType, targetId: r.targetId, summary: r.summary,
        metadata: r.metadata ?? null, clientIp: r.clientIp,
      });
      await tx.adminAuditEvent.update({ where: { id: r.id }, data: { seq, prevHash: lastHash, hash } });
      lastSeq = seq;
      lastHash = hash;
    }
    await tx.auditChainState.update({ where: { id: ADMIN_CHAIN_ID }, data: { lastSeq, lastHash } });
    return { backfilled: pending.length };
  });
}
