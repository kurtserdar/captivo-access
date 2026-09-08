// Deployment-level toggle: single-tenant self-host (off) vs multi-tenant cloud
// (on). Mirrors the other capability flags (isolationEnabled, recordingEnabled).
// Off for the self-hosted OSS product — the tenant machinery is then a no-op.
import { flagOn } from "@/lib/env-flag";

export function multiTenantEnabled(): boolean {
  return flagOn(process.env.MULTI_TENANT, false);
}
