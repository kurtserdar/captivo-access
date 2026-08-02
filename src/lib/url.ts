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

// Placeholder used when the connector tunnel (WSS) endpoint can't be resolved
// from config — the operator must fill it in.
export const CONNECTOR_TUNNEL_PLACEHOLDER = "wss://connect.<your-access-domain>";

/**
 * Best-effort derivation of the connector tunnel (WSS) endpoint from the
 * manager's public URL, following the deploy convention where the manager is at
 * `manager.<domain>` and the connector tunnel is at `connect.<domain>`.
 *
 * Returns `null` when it can't derive confidently (no `manager.` prefix, or a
 * custom port — e.g. the `localhost:3100` dev URL), so the caller can fall back
 * to an explicit env value or the placeholder rather than emit something wrong.
 */
export function deriveTunnelUrl(managerPublicUrl: string | undefined): string | null {
  const raw = managerPublicUrl?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.port) return null; // custom port (dev localhost:3100 etc.) — don't guess
  if (!url.hostname.startsWith("manager.")) return null;
  const connectHost = "connect." + url.hostname.slice("manager.".length);
  const wsScheme = url.protocol === "https:" ? "wss" : "ws";
  return `${wsScheme}://${connectHost}`;
}

/**
 * The connector tunnel (WSS) endpoint to put in a connector's install command.
 * Prefers the explicit `CONNECTOR_TUNNEL_URL` env, then derives from
 * `MANAGER_PUBLIC_URL`, and finally falls back to a placeholder the operator
 * must replace.
 */
export function connectorTunnelUrl(): string {
  const configured = process.env.CONNECTOR_TUNNEL_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return deriveTunnelUrl(process.env.MANAGER_PUBLIC_URL) ?? CONNECTOR_TUNNEL_PLACEHOLDER;
}
