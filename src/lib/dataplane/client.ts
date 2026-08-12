// Reuses the existing manager→data-plane internal env (same one lib/connector/
// dataplane.ts uses) so no new configuration is needed on any deployment.
const BASE = () => (process.env.DATAPLANE_URL || "http://access-dataplane:3102").replace(/\/+$/, "");
function authHeaders(): Record<string, string> {
  return { "content-type": "application/json", "x-dataplane-secret": process.env.DATAPLANE_SECRET ?? "" };
}

export interface ActiveSession {
  sessionId: string;
  siteId: string;
  userId: string;
  protocol: string;
  host: string;
  startedAt: string;
  viewerCount: number;
  controlOwner: string;
}

export async function listActiveSessions(): Promise<ActiveSession[]> {
  try {
    const res = await fetch(`${BASE()}/sessions`, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as ActiveSession[] | null;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function setSessionControl(
  sessionId: string,
  ownerUserId: string,
  action: "take" | "release",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`${BASE()}/sessions/control`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionId, ownerUserId, action }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    return (await res.json()) as { ok: boolean; reason?: string };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

export async function getWatchStatus(userId: string, siteId: string): Promise<{ watching: boolean; controlHeld: boolean }> {
  try {
    const qs = `userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}`;
    const res = await fetch(`${BASE()}/sessions/watch-status?${qs}`, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return { watching: false, controlHeld: false };
    return (await res.json()) as { watching: boolean; controlHeld: boolean };
  } catch {
    return { watching: false, controlHeld: false };
  }
}

export async function terminateSession(sessionId: string): Promise<{ ok: boolean; found: boolean }> {
  try {
    const res = await fetch(`${BASE()}/sessions/terminate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionId }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, found: false };
    return (await res.json()) as { ok: boolean; found: boolean };
  } catch {
    return { ok: false, found: false };
  }
}
