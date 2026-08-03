import { db } from "@/lib/db";

export type NotificationType = "site_down" | "site_recovered";

// Edge-triggered: only a real transition produces an event, so a Site that
// stays down doesn't notify every cycle. null (never probed) -> false counts
// as down so a newly-added, unreachable Site surfaces.
export function classifyTransition(oldOk: boolean | null, newOk: boolean): NotificationType | null {
  if (newOk === false && oldOk !== false) return "site_down";
  if (newOk === true && oldOk === false) return "site_recovered";
  return null;
}

export async function countUnreadNotifications(): Promise<number> {
  return db.notification.count({ where: { readAt: null } });
}

export async function notifyTransition(input: {
  type: NotificationType;
  siteId: string;
  siteName: string;
  detail: string | null;
}): Promise<void> {
  try {
    await db.notification.create({
      data: { type: input.type, siteId: input.siteId, siteName: input.siteName, detail: input.detail },
    });
  } catch {
    // Best-effort: a failed notification row insert must never break the cron.
  }
  await fireWebhook(input);
}

async function fireWebhook(input: {
  type: NotificationType;
  siteName: string;
  detail: string | null;
}): Promise<void> {
  const url = process.env.NOTIFICATION_WEBHOOK_URL?.trim();
  if (!url) return;
  const text =
    input.type === "site_down"
      ? `${input.siteName} is down${input.detail ? ": " + input.detail : ""}`
      : `${input.siteName} recovered`;
  const payload = {
    text,
    event: input.type,
    site: input.siteName,
    detail: input.detail ?? undefined,
    at: new Date().toISOString(),
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort: a failed/slow webhook must never break the cron.
  }
}
