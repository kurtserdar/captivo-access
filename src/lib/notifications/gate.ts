import { getPlatformSettings } from "@/lib/settings/platform";
import { emailEnabledFromValue, type NotifKey } from "./events";

// Server-only: resolves whether email for an event type is enabled, reading the
// PlatformSettings toggles (default on). Kept out of ./events so that module
// stays client-safe (the Policy form imports the registry from there).
export async function notifyEmailEnabled(key: NotifKey): Promise<boolean> {
  const s = await getPlatformSettings();
  const map: Record<NotifKey, boolean | null> = {
    site_health: s.notifySiteHealth,
    access_requests: s.notifyAccessRequests,
    access_decisions: s.notifyAccessDecisions,
  };
  return emailEnabledFromValue(map[key]);
}
