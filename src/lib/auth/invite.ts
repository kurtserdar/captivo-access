import { db } from "@/lib/db";
import { generateToken, hashToken, verifyTokenHash } from "./tokens";
import type { Role } from "@/generated/prisma/enums";

function ttlMs() {
  const h = Number(process.env.INVITE_TTL_HOURS ?? "48");
  return (Number.isFinite(h) && h > 0 ? h : 48) * 3600_000;
}

export async function createInvite(input: {
  email: string;
  name: string;
  role: Role;
  createdById: string;
  phone?: string | null;
  company?: string | null;
}) {
  const token = generateToken();
  const inv = await db.invite.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      phone: input.phone ?? null,
      company: input.company ?? null,
      tokenHash: await hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs()),
      createdById: input.createdById,
    },
  });
  return { id: inv.id, token };
}

export async function verifyInvite(token: string) {
  // argon2 hash → a unique tokenHash lookup isn't possible; scan all valid invites.
  const candidates = await db.invite.findMany({ where: { usedAt: null, expiresAt: { gt: new Date() } } });
  for (const inv of candidates) {
    if (await verifyTokenHash(token, inv.tokenHash)) return inv;
  }
  return null;
}
