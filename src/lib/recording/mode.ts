// Applies the tenant recording policy to a resource's own toggle. The global
// RECORDING_ENABLED capability is applied separately by the caller.
export function effectiveRecordSessions(mode: string, siteToggle: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "required") return true;
  return siteToggle; // "per_resource" and any unknown value → resource decides
}
