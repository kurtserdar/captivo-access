// Applies the tenant recording policy to a resource's own toggle. The global
// RECORDING_ENABLED capability is applied separately by the caller.
export function effectiveRecordSessions(mode: string, siteToggle: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "required") return true;
  return siteToggle; // "per_resource" and any unknown value → resource decides
}

// UI helper: whether the resource-form "record sessions" toggle should be
// locked to a fixed value under the tenant's recording policy, and to what.
export function recordToggleLock(mode: string): { locked: boolean; forcedValue: boolean | null } {
  if (mode === "required") return { locked: true, forcedValue: true };
  if (mode === "off") return { locked: true, forcedValue: false };
  return { locked: false, forcedValue: null };
}
