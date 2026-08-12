import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { computeAdminHash, ADMIN_AUDIT_CHAIN_LOCK_KEY, ADMIN_CHAIN_ID } from "@/lib/audit/admin-chain";

export interface AdminActor { id: string; email: string | null }

// Records a security-critical admin mutation into the tamper-evident admin
// chain. Best-effort: a failure to write the audit row is logged but never
// thrown, so it can never break the action. A missed row is a coverage gap,
// not a chain break — the surviving rows still verify against each other.
//
// The append is serialized on a dedicated advisory lock (distinct from the
// access chain's) so concurrent admin actions never race the chain head.
export async function recordAdminAction(input: {
  actor: AdminActor;
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  clientIp?: string | null;
}): Promise<void> {
  try {
    const timestamp = new Date();
    const metadata = input.metadata ?? null;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_AUDIT_CHAIN_LOCK_KEY})`;
      const head = await tx.auditChainState.upsert({
        where: { id: ADMIN_CHAIN_ID },
        create: { id: ADMIN_CHAIN_ID },
        update: {},
        select: { lastSeq: true, lastHash: true },
      });
      const seq = head.lastSeq + BigInt(1);
      const prevHash = head.lastHash;
      const hash = computeAdminHash(prevHash, {
        seq,
        timestamp,
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        summary: input.summary,
        metadata,
        clientIp: input.clientIp ?? null,
      });
      await tx.adminAuditEvent.create({
        data: {
          timestamp,
          actorId: input.actor.id,
          actorEmail: input.actor.email,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          summary: input.summary,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
          clientIp: input.clientIp ?? null,
          seq,
          prevHash,
          hash,
        },
      });
      await tx.auditChainState.update({ where: { id: ADMIN_CHAIN_ID }, data: { lastSeq: seq, lastHash: hash } });
    });
  } catch (e) {
    console.error("recordAdminAction failed:", input.action, e);
  }
}
