import { db } from "@/lib/db";

export async function createGrant(input: {
  userId: string;
  siteId: string;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string | null;
  createdById: string;
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
      note: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
      site: { select: { name: true } },
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
      site: { select: { name: true } },
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
      },
    });
    return { ok: true as const, id: g.id };
  });
}

export async function listSitesForRequest(): Promise<{ id: string; name: string }[]> {
  return db.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}
