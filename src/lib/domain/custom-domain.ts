/**
 * Derive the bare "access domain" (e.g. "access.example.com") that vendor app
 * subdomains live under. Prefers an explicit ACCESS_DOMAIN; otherwise strips a
 * leading "manager." from the MANAGER_PUBLIC_URL host. Returns null when it
 * can't derive confidently (unset, localhost, no "manager." prefix, or a bare
 * single-label result), so callers show a placeholder rather than emit
 * something wrong.
 */
export function accessDomain(managerPublicUrl?: string, accessDomainEnv?: string): string | null {
  const explicit = accessDomainEnv?.trim();
  if (explicit) return explicit.replace(/^\*\./, "").toLowerCase();

  const raw = managerPublicUrl?.trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "localhost" || host === "127.0.0.1" || !host.startsWith("manager.")) return null;
  const domain = host.slice("manager.".length);
  return domain.includes(".") ? domain : null;
}

/** The wildcard DNS record name for the access domain, e.g. "*.access.example.com". */
export function wildcardRecord(accessDomain: string): string {
  return `*.${accessDomain}`;
}

export type VerifyStatus = "ok" | "missing" | "mismatch";

/**
 * Classify a wildcard-DNS check: given the expected server IP and the IPs a
 * probe subdomain resolved to, decide whether the wildcard record is correct.
 * - no IPs (NXDOMAIN / no answer) -> "missing"
 * - expected IP present            -> "ok"
 * - resolves, but not to expected  -> "mismatch"
 */
export function classifyVerify(expectedIp: string, resolvedIps: string[]): VerifyStatus {
  if (resolvedIps.length === 0) return "missing";
  return resolvedIps.includes(expectedIp) ? "ok" : "mismatch";
}
