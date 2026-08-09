import { db } from "@/lib/db";
import type { Schedule } from "@/lib/access/schedule";

export async function createGrant(input: {
  userId: string;
  siteId: string;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string | null;
  createdById: string;
  schedule: Schedule | null;
}): Promise<{ id: string }> {
  const g = await db.accessGrant.create({
    data: {
      userId: input.userId,
      siteId: input.siteId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      note: input.note,
      requiresApproval: false,
      status: "ACTIVE",
      createdById: input.createdById,
      ...(input.schedule ? { schedule: input.schedule as object } : {}),
    },
  });
  return { id: g.id };
}

export async function listGrants() {
  return db.accessGrant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      requiresApproval: true,
      approvedAt: true,
      schedule: true,
      note: true,
      denyReason: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
      site: { select: { name: true, hostname: true } },
    },
  });
}

export async function revokeGrant(id: string): Promise<void> {
  await db.accessGrant.updateMany({ where: { id }, data: { status: "REVOKED" } });
}

export async function listUserGrants(userId: string) {
  return db.accessGrant.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      requiresApproval: true,
      approvedAt: true,
      schedule: true,
      denyReason: true,
      site: { select: { name: true, hostname: true, recordSessions: true } },
    },
  });
}

// A vendor's self-service access request: a grant that requires approval and is not yet
// approved (classifyGrant → pending_approval → denied until an admin approves).
export async function createAccessRequest(input: {
  userId: string;
  siteId: string;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string;
  schedule: Schedule | null;
}): Promise<{ ok: true; id: string } | { ok: false; reason: "request_pending" }> {
  return db.$transaction(async (tx) => {
    // One pending request per (user, site) at a time.
    const existing = await tx.accessGrant.findFirst({
      where: {
        userId: input.userId,
        siteId: input.siteId,
        status: "ACTIVE",
        requiresApproval: true,
        approvedAt: null,
      },
      select: { id: true },
    });
    if (existing) return { ok: false as const, reason: "request_pending" as const };

    const g = await tx.accessGrant.create({
      data: {
        userId: input.userId,
        siteId: input.siteId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note,
        requiresApproval: true,
        status: "ACTIVE",
        approvedAt: null,
        createdById: input.userId,
        ...(input.schedule ? { schedule: input.schedule as object } : {}),
      },
    });
    return { ok: true as const, id: g.id };
  });
}

export async function listSitesForRequest(): Promise<{ id: string; name: string }[]> {
  return db.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

const PENDING_WHERE = { status: "ACTIVE", requiresApproval: true, approvedAt: null } as const;

export async function listPendingGrants() {
  return db.accessGrant.findMany({
    where: PENDING_WHERE,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      note: true,
      createdAt: true,
      schedule: true,
      user: { select: { name: true, email: true } },
      site: { select: { name: true, hostname: true } },
    },
  });
}

export async function countPendingGrants(): Promise<number> {
  return db.accessGrant.count({ where: PENDING_WHERE });
}

// Approve or deny a pending request. Conditional on the grant still being pending, so a
// double-decide (or two admins racing) is a no-op the caller reads as "not pending".
export async function decideGrant(
  id: string,
  decision: "approve" | "deny",
  adminId: string,
  reason?: string | null,
): Promise<number> {
  const now = new Date();
  const data =
    decision === "approve"
      ? { approvedAt: now, approvedById: adminId }
      : { status: "DENIED" as const, approvedAt: now, approvedById: adminId, denyReason: reason ?? null };
  const res = await db.accessGrant.updateMany({ where: { id, ...PENDING_WHERE }, data });
  return res.count;
}
