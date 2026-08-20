import type { KeystrokeMode } from "@/lib/settings/platform";

// Effective per-session keystroke-logging decision. Keystroke logging is an
// adjunct to recording (the timeline seeks the recording), so every mode is
// gated on recording being active for the session — including "required".
export function effectiveKeystrokeLogging(input: {
  mode: KeystrokeMode;
  recordingEnabled: boolean;
  recordSessions: boolean;
  siteFlag: boolean;
}): boolean {
  const base = input.recordingEnabled && input.recordSessions;
  if (!base) return false;
  switch (input.mode) {
    case "off":
      return false;
    case "required":
      return true;
    case "per_resource":
      return input.siteFlag;
    default:
      return input.siteFlag;
  }
}
