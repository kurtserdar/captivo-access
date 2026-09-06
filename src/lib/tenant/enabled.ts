// Deployment-level toggle: single-tenant self-host (off) vs multi-tenant cloud
// (on). Mirrors the other capability flags (isolationEnabled, recordingEnabled).
// Off for the self-hosted OSS product — the tenant machinery is then a no-op.
export function multiTenantEnabled(): boolean {
  const v = process.env.MULTI_TENANT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
