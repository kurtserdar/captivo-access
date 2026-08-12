export const EXTEND_OPTIONS: { label: string; hours: number }[] = [
  { label: "+1h", hours: 1 },
  { label: "+1d", hours: 24 },
  { label: "+7d", hours: 168 },
];

// New end = whichever is later (the current end or now) + the increment. Extends
// a still-valid grant from its end, and a lapsing/expired one from now.
export function nextEndsAt(currentEndISO: string | null, hours: number, now: Date): string {
  const base = currentEndISO ? Math.max(now.getTime(), new Date(currentEndISO).getTime()) : now.getTime();
  return new Date(base + hours * 3600 * 1000).toISOString();
}
