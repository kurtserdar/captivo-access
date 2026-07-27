import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "ca_challenge";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required");
  return new TextEncoder().encode(s);
}

export async function setChallenge(challenge: string, purpose: "reg" | "auth", uid?: string): Promise<void> {
  const payload: Record<string, string> = { challenge, purpose };
  if (uid !== undefined) payload.uid = uid;
  const jwt = await new SignJWT(payload)
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

/** Reads the uid if it was passed to setChallenge for "reg" (setup/invite — to
 *  align the persistent User.id with the WebAuthn userHandle). auth/add/recover
 *  don't set a uid → returns null. */
export async function readChallengeUid(purpose: "reg" | "auth"): Promise<string | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c, secret());
    if (payload.purpose !== purpose) return null;
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

export async function clearChallenge(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/" });
}
