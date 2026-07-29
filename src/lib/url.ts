import { NextRequest } from "next/server";

/**
 * The manager's browser-facing base URL (no trailing slash), for building
 * absolute user-facing links (e.g. invite links).
 *
 * Prefers `MANAGER_PUBLIC_URL` (the configured public address). Otherwise it
 * derives the origin from the request's forwarded/Host headers. It must NOT use
 * `req.nextUrl.origin`, which in a standalone/containerized server resolves to
 * the server's own hostname (e.g. the Docker container id), not the address the
 * browser used — falling back to it only as a last resort.
 */
export function managerBaseUrl(req: NextRequest): string {
  const configured = process.env.MANAGER_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    req.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}
