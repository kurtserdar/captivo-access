import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { generateToken, sha256 } from "./tokens";
import { cookieSecure, cookieDomain } from "./cookies";

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

// Session cookie max-age (hours) — mirrors the value used by the passkey auth
// route. Kept here so non-passkey logins (OIDC) set an identical cookie without
// modifying the passkey flow.
function sessionMaxAgeSeconds(): number {
  const h = Number(process.env.SESSION_TTL_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3600;
}

/** Create a DB-backed session for `userId` and set the `ca_session` cookie,
 *  identically to the passkey auth route. Used by non-passkey logins (OIDC). */
export async function startSession(userId: string, req: NextRequest): Promise<void> {
  const meta = {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
  };
  const token = await createSession(userId, meta);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: await cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeSeconds(),
    domain: cookieDomain(),
  });
}
