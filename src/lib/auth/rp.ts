import type { NextRequest } from "next/server";

export function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID?.trim() || "localhost";
}

/**
 * The origin as the browser sees it — the value WebAuthn checks against
 * clientDataJSON.origin. Prefers the request's `Origin` header (browsers send
 * it on fetch POSTs and it is exactly the browser's origin); falls back to
 * `x-forwarded-host`/`host` + proto. `req.nextUrl.origin` is NOT used because
 * in a standalone/containerized server it reflects the server's own hostname
 * (e.g. the Docker container id), not the address the browser used.
 */
export function requestOrigin(req: NextRequest): string {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    req.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

/** Whether the origin's host matches the RP-ID (WebAuthn origin verification). */
export function originMatchesRp(origin: string, rpId: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === rpId;
  } catch {
    return false;
  }
}
