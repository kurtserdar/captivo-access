import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// Short-lived, jose-signed cookie for the TOTP recovery flow — mirrors the
// pattern in challenge.ts. `/api/auth/recover` sets this cookie after
// verifying email+TOTP; registration mode:"recover" requires it (to add
// a new Passkey to an existing user).
const COOKIE = "ca_recover";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required");
  return new TextEncoder().encode(s);
}

export async function setRecoverToken(userId: string): Promise<void> {
  const jwt = await new SignJWT({ userId, purpose: "recover" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(secret());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
}

export async function readRecoverToken(): Promise<string | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c, secret());
    if (payload.purpose !== "recover" || typeof payload.userId !== "string") return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export async function clearRecoverToken(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/" });
}
