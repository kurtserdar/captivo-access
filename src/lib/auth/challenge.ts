import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "ca_challenge";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET gerekli");
  return new TextEncoder().encode(s);
}

export async function setChallenge(challenge: string, purpose: "reg" | "auth"): Promise<void> {
  const jwt = await new SignJWT({ challenge, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(secret());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 300, path: "/" });
}

export async function readChallenge(purpose: "reg" | "auth"): Promise<string | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c, secret());
    if (payload.purpose !== purpose) return null;
    return String(payload.challenge);
  } catch {
    return null;
  }
}

export async function clearChallenge(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
