import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cookieSecure } from "./cookies";

const COOKIE = "ca_oidc";
const TTL_SECONDS = 600; // 10 minutes to complete the round trip

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required");
  return new TextEncoder().encode(s);
}

type OidcState = { state: string; nonce: string; codeVerifier: string; returnTo: string };

export async function setOidcState(data: OidcState): Promise<void> {
  const jwt = await new SignJWT({ ...data })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, jwt, {
    httpOnly: true,
    secure: await cookieSecure(),
    sameSite: "lax",
    maxAge: TTL_SECONDS,
    path: "/",
  });
}

export async function readOidcState(): Promise<OidcState | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c, secret());
    const { state, nonce, codeVerifier, returnTo } = payload as Record<string, unknown>;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof codeVerifier !== "string" || typeof returnTo !== "string") {
      return null;
    }
    return { state, nonce, codeVerifier, returnTo };
  } catch {
    return null;
  }
}

export async function clearOidcState(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/" });
}
