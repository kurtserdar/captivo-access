import { cache } from "react";
import { resolveRequestTenant } from "@/lib/tenant/request";

// Thrown when a cloud db op runs with neither an ambient tenant scope nor a
// resolvable request tenant (a non-request context that forgot to wrap, or an
// unknown host). Fail-fast, not fail-closed-silent.
export class TenantScopeRequiredError extends Error {
  constructor(message = "tenant scope required: no ambient scope and no resolvable request tenant") {
    super(message);
    this.name = "TenantScopeRequiredError";
  }
}

// Resolve the tenant for the current request, memoized per server request where
// React cache() applies (RSC/route handlers). resolveRequestTenant reads
// next/headers internally (already dynamic-safe) and returns null off-request or
// for an unknown host — both become the fail-fast error.
export const resolveAmbientRequestTenant = cache(async (): Promise<string> => {
  let tid: string | null = null;
  try {
    tid = await resolveRequestTenant();
  } catch {
    tid = null; // headers() unavailable (non-request context)
  }
  if (!tid) throw new TenantScopeRequiredError();
  return tid;
});
