// Pure helpers for the tenant CONSOLE host scheme (<slug>.<consoleDomain>). No DB,
// no next/headers — safe to import from URL builders and tests.
import { accessDomain } from "@/lib/domain/custom-domain";

// Subdomain labels that are never a tenant slug (the manager host + common
// infra names live under the access domain too).
export const RESERVED = new Set(["manager", "www", "app", "admin", "api", "connect", "sites"]);

// The domain tenant consoles live under. Prefers CONSOLE_DOMAIN; otherwise the
// access domain, so a deployment that co-locates consoles and sites under one
// domain (and the single-tenant default) is unchanged.
export function consoleDomain(): string | null {
  return (
    process.env.CONSOLE_DOMAIN?.trim() ||
    accessDomain(process.env.MANAGER_PUBLIC_URL, process.env.ACCESS_DOMAIN)
  );
}

// Extracts the single-label tenant slug from a request host, given the bare
// domain (e.g. "access.example.com"). `<slug>.<domain>` → slug; the bare
// domain, a reserved label, a multi-label subdomain, a non-matching host, or a
// null domain → null. Pure.
export function slugFromHost(host: string, domain: string | null): string | null {
  if (!host || !domain) return null;
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const suffix = "." + domain.toLowerCase();
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!label || label.includes(".") || RESERVED.has(label)) return null;
  return label;
}
