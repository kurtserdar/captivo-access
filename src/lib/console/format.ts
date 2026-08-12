// "5m" / "1h 05m" — elapsed time since a session started.
export function duration(startISO: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(startISO).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// "14h 16m" / "under 1h" — time left until a grant's window closes.
export function expiresIn(endISO: string, now: Date): string {
  const mins = Math.floor((new Date(endISO).getTime() - now.getTime()) / 60000);
  if (mins < 60) return "under 1h";
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
