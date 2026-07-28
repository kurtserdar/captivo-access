/**
 * Open-redirect guard for the post-login `returnTo` destination.
 *
 * Allowed:
 * - a relative path starting with a single `/` (not the protocol-relative
 *   `//host/...` form, which browsers treat as an absolute URL);
 * - when `COOKIE_DOMAIN` is set, an absolute `https://` URL whose host is
 *   the bare cookie domain or a subdomain of it (so the proxy can bounce
 *   an unauthenticated request on any `*.access.<domain>` site back to the
 *   manager and land back on the originating site).
 *
 * Everything else falls back to `"/"`.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  // Relative path (single leading slash, not protocol-relative "//").
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;

  const domain = process.env.COOKIE_DOMAIN?.trim();
  if (domain) {
    try {
      const u = new URL(raw);
      const suffix = domain.startsWith(".") ? domain : "." + domain;
      if (
        u.protocol === "https:" &&
        (u.host === domain.replace(/^\./, "") || u.host.endsWith(suffix))
      ) {
        return u.toString();
      }
    } catch {
      /* fall through */
    }
  }

  return "/";
}
