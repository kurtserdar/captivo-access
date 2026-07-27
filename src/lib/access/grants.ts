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
