import { db } from "@/lib/db";
import { generateToken, sha256 } from "./tokens";

export const SESSION_COOKIE = "ca_session";
function ttlMs(): number {
  const h = Number(process.env.SESSION_TTL_HOURS ?? "12");
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3600_000;
}

export async function createSession(userId: string, meta?: { userAgent?: string; ip?: string }): Promise<string> {
  const token = generateToken();
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMs()),
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    },
  });
  return token;
}

export async function getSessionUser(token: string) {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  if (s.user.status !== "ACTIVE") return null;
  // sliding: update last-seen (extending expiry is optional — MVP only updates lastSeenAt)
  await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return s.user;
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}
export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.delete({ where: { id: sessionId } }).catch(() => {});
}
