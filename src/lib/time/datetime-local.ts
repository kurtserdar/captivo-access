// Wall-clock ↔ instant conversions for <input type="datetime-local"> and
// <input type="date"> values in a given IANA zone. `tz === null` means the
// runtime's own local zone (on the client: the viewer's browser), which is the
// fallback when no display timezone is configured. Uses only Intl — DST-correct,
// no external dependency.

const DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const D_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

const pad = (n: number) => String(n).padStart(2, "0");

function validWall(w: Wall): boolean {
  if (w.mo < 1 || w.mo > 12 || w.d < 1 || w.h > 23 || w.mi > 59 || w.s > 59) return false;
  // Reject calendar rollover (e.g. Feb 30 → Mar 2).
  return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDate() === w.d;
}

function fmt(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
}

// The wall-clock components of `at` as seen in `tz`.
function wallIn(tz: string, at: Date): Wall {
  const parts = fmt(tz).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

// UTC offset of `tz` at instant `at`, in milliseconds (east of UTC positive).
function offsetMs(tz: string, at: Date): number {
  const w = wallIn(tz, at);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  // Drop sub-second noise: the formatter only carries whole seconds.
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// Interpret a wall-clock time in `tz` as an instant. Around a DST gap (a wall
// time that never happens) the result lands on the nearest valid instant; in a
// DST overlap the first (earlier) occurrence is chosen.
function instantOf(w: Wall, tz: string | null): Date {
  if (tz === null) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const guess = asUtc - offsetMs(tz, new Date(asUtc));
  const refined = asUtc - offsetMs(tz, new Date(guess));
  return new Date(refined);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// "YYYY-MM-DDTHH:mm[:ss]" (a datetime-local value) in `tz` → Date, or null when malformed.
export function parseDatetimeLocal(value: string, tz: string | null): Date | null {
  const m = DT_RE.exec(value);
  if (!m) return null;
  const w: Wall = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 };
  if (!validWall(w)) return null;
  return instantOf(w, tz);
}

// Date → "YYYY-MM-DDTHH:mm" as seen in `tz` (the value for a datetime-local input).
export function formatDatetimeLocal(date: Date, tz: string | null): string {
  if (Number.isNaN(date.getTime())) return "";
  const w: Wall = tz === null
    ? { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes(), s: 0 }
    : wallIn(tz, date);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

// "YYYY-MM-DD" (a date input value) → the instant the day starts in `tz`, or null when malformed.
export function startOfDayInZone(value: string, tz: string | null): Date | null {
  const m = D_RE.exec(value);
  if (!m) return null;
  const w: Wall = { y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0 };
  if (!validWall(w)) return null;
  return instantOf(w, tz);
}

// "YYYY-MM-DD" → the last millisecond of that day in `tz` (inclusive upper bound), or null.
export function endOfDayInZone(value: string, tz: string | null): Date | null {
  const start = startOfDayInZone(value, tz);
  if (!start) return null;
  const m = D_RE.exec(value)!;
  // Start of the NEXT calendar day, minus 1 ms — DST-safe (a day can be 23 or 25 h).
  const next = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  const nextStart = instantOf({ y: next.getUTCFullYear(), mo: next.getUTCMonth() + 1, d: next.getUTCDate(), h: 0, mi: 0, s: 0 }, tz);
  return new Date(nextStart.getTime() - 1);
}
