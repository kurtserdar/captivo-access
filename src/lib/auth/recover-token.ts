import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// TOTP-kurtarma akışı için kısa ömürlü, jose-imzalı cookie — challenge.ts'deki
// pattern'i yansıtır. `/api/auth/recover` e-posta+TOTP'yi doğruladıktan sonra
// bu cookie'yi set eder; registration mode:"recover" bunu ister (mevcut
// kullanıcıya yeni Passkey eklemek için).
const COOKIE = "ca_recover";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET gerekli");
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
