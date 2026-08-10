import { getPlatformSettings } from "@/lib/settings/platform";

// Canonical notification event keys, with UI metadata so the Policy form and the
// send sites agree on one list. Toggles govern EMAIL only — the in-console bell
// and the webhook are unaffected.
export type NotifKey = "site_health" | "access_requests" | "access_decisions";

export const NOTIF_EVENTS: { key: NotifKey; label: string; hint: string }[] = [
  { key: "site_health", label: "Site up / down", hint: "Email admins when a site becomes unreachable or recovers." },
  { key: "access_requests", label: "New access requests", hint: "Email admins when a vendor requests access to a site." },
  { key: "access_decisions", label: "Access decisions", hint: "Email the vendor when their access request is approved or denied." },
];

// Default-on rule: email is enabled unless the stored value is explicitly false.
export function emailEnabledFromValue(v: boolean | null | undefined): boolean {
  return v !== false;
}

export async function notifyEmailEnabled(key: NotifKey): Promise<boolean> {
  const s = await getPlatformSettings();
  const map: Record<NotifKey, boolean | null> = {
    site_health: s.notifySiteHealth,
    access_requests: s.notifyAccessRequests,
    access_decisions: s.notifyAccessDecisions,
  };
  return emailEnabledFromValue(map[key]);
}
