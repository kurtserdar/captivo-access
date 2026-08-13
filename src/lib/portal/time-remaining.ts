export interface Remaining {
  text: string;
  pct: number; // 0–100, percentage of the window REMAINING (bar depletes toward expiry)
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

// `schedule` is only used as a "has a recurring schedule?" flag, so it accepts
// any truthy value (the grant's schedule is stored as JSON).
export function remaining(startISO: string | null, endISO: string | null, schedule: unknown, now: Date): Remaining {
  // No end date → no depleting window; show a full bar (always/recurring available).
  if (!endISO) {
    if (schedule) return { text: "Scheduled window", pct: 100, tone: "schedule" };
    return { text: "Permanent", pct: 100, tone: "ok" };
  }
  const end = new Date(endISO).getTime();
  const start = startISO ? new Date(startISO).getTime() : now.getTime();
  const n = now.getTime();
  const total = Math.max(1, end - start);
  const elapsed = Math.min(total, Math.max(0, n - start));
  // Percentage of the window REMAINING: full when lots of time is left, empty at
  // expiry, so the bar depletes as the window is consumed.
  const pct = Math.round(((total - elapsed) / total) * 100);
  const msLeft = end - n;
  // "urgent" only in the final stretch — an amber bar should mean "about to
  // expire", not merely "under a day left" (a 24h grant would otherwise be amber
  // its whole life).
  const tone: Remaining["tone"] = msLeft < 60 * 60 * 1000 ? "urgent" : "ok";
  return { text: humanize(msLeft), pct, tone };
}
