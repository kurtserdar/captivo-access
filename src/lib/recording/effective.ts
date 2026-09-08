import { recordingEnabled } from "@/lib/recording/enabled";
import { effectiveRecordSessions } from "@/lib/recording/mode";
import { resolvedRecordingMode } from "@/lib/settings/platform";

// The effective "is this resource's session recorded" decision — capability master
// AND the tenant recording policy applied to the resource's own toggle. The single
// source of truth; every gate and every disclosure/consent/display surface must use it.
//
// Server-only (pulls in the tenant settings resolver, hence the DB). Kept in its own
// module rather than in enabled.ts/mode.ts so those leaf helpers stay importable from
// client components (e.g. the resource form's recordToggleLock) without dragging Prisma
// into the client bundle.
export async function effectiveSiteRecording(recordSessions: boolean): Promise<boolean> {
  return recordingEnabled() && effectiveRecordSessions(await resolvedRecordingMode(), recordSessions);
}
