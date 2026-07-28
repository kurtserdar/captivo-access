import { headers } from "next/headers";

/**
 * Whether auth cookies should carry the `Secure` attribute.
 *
 * Secure by default. It is relaxed only for plain-HTTP localhost development
 * (e.g. an SSH tunnel to http://localhost:3100), where a `Secure` cookie would
 * not be stored/sent by the browser and would break the WebAuthn ceremony.
 *
 * Behind a TLS-terminating reverse proxy (the intended production topology),
 * the proxy sets `x-forwarded-proto: https`, so cookies stay Secure.
 */
export async function cookieSecure(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const host = (h.get("host") ?? "").toLowerCase();
  return !(
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  );
}

/**
 * The `Domain` attribute for the session cookie, from `COOKIE_DOMAIN`.
 *
 * Set this (e.g. `.access.example.com`) so the cookie is shared across
 * `*.access.example.com` subdomains — the manager sets it, and the proxy
 * running on any site subdomain can read it. Unset by default, which
 * leaves the cookie host-only (unaffected in dev).
 */
export function cookieDomain(): string | undefined {
  const d = process.env.COOKIE_DOMAIN?.trim();
  return d ? d : undefined;
}
