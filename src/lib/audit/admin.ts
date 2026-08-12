import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface AdminActor { id: string; email: string | null }

// Records a security-critical admin mutation. Best-effort: a failure to write
// the audit row is logged but never thrown, so it can never break the action.
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
    await db.adminAuditEvent.create({
      data: {
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        summary: input.summary,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
        clientIp: input.clientIp ?? null,
      },
    });
  } catch (e) {
    console.error("recordAdminAction failed:", input.action, e);
  }
}
