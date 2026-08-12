export interface Remaining {
  text: string;
  pct: number; // 0–100, percentage of the window elapsed
  tone: "urgent" | "ok" | "schedule";
}

// Humanizes a millisecond span, e.g. "14h 16m left", "2d 20h left".
function humanize(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function remaining(startISO: string | null, endISO: string | null, schedule: string | null, now: Date): Remaining {
  if (!endISO) {
    if (schedule) return { text: "Scheduled window", pct: 0, tone: "schedule" };
    return { text: "Permanent", pct: 0, tone: "ok" };
  }
  const end = new Date(endISO).getTime();
  const start = startISO ? new Date(startISO).getTime() : now.getTime();
  const n = now.getTime();
  const total = Math.max(1, end - start);
  const elapsed = Math.min(total, Math.max(0, n - start));
  const pct = Math.round((elapsed / total) * 100);
  const msLeft = end - n;
  const tone: Remaining["tone"] = msLeft < 24 * 3600 * 1000 ? "urgent" : "ok";
  return { text: humanize(msLeft), pct, tone };
}
