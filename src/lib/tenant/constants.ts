// The reserved control-plane tenant. Platform super-admins live here; its slug
// resolves the platform console host (platform.<accessDomain>).
export const PLATFORM_TENANT_ID = "platform";

// Slugs a customer tenant may never claim: the platform console + the infra
// labels that are never a tenant host (kept in sync with RESERVED in resolve.ts).
export const RESERVED_SLUGS = new Set(["platform", "manager", "www", "app", "admin", "api"]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

// A valid tenant slug is a single lowercase DNS label (RFC 1035): 1–63 chars,
// [a-z0-9] with internal hyphens, not starting/ending with a hyphen, not reserved.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function isValidTenantSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !isReservedSlug(slug);
}
