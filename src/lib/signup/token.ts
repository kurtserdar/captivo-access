// Self-service signup (Cloud, opt-in): the form's data travels in a signed,
// short-lived JWT inside the verification email — nothing is stored until the
// link is clicked, so unverified signups cost nothing and cannot squat slugs.
import { SignJWT, jwtVerify } from "jose";

export const SIGNUP_TTL_SECONDS = 30 * 60;
export const TRIAL_DAYS = 14;

export interface SignupClaims { name: string; slug: string; email: string; adminName: string }

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required");
  return new TextEncoder().encode(s);
}

export async function signSignup(c: SignupClaims): Promise<string> {
  return new SignJWT({ ...c, purpose: "signup" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(`${SIGNUP_TTL_SECONDS}s`).sign(secret());
}

export async function verifySignup(token: string): Promise<SignupClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== "signup") return null;
    const { name, slug, email, adminName } = payload as Record<string, unknown>;
    if (typeof name !== "string" || typeof slug !== "string" || typeof email !== "string") return null;
    return { name, slug, email, adminName: typeof adminName === "string" ? adminName : "" };
  } catch {
    return null;
  }
}
