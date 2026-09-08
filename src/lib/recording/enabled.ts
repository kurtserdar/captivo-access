// The single capability gate for session recording. Source is swappable
// (env now; license/on later) — callers must not assume env specifically.
// On by default.
import { flagOn } from "@/lib/env-flag";

export function recordingEnabled(): boolean {
  return flagOn(process.env.RECORDING_ENABLED, true);
}
