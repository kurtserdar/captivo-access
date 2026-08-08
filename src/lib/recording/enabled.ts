// The single capability gate for session recording. Source is swappable
// (env now; license/on later) — callers must not assume env specifically.
export function recordingEnabled(): boolean {
  const v = process.env.RECORDING_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
