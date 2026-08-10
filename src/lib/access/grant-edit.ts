// Validate an edit to a grant's end date. Returns an error code, or null if valid.
// Pure + db-free so it unit-tests in the vitest node env.
export function grantEndsAtError(endsAt: Date, startsAt: Date | null, now: Date): string | null {
  if (Number.isNaN(endsAt.getTime())) return "invalid_ends_at";
  if (endsAt <= now) return "ends_at_in_past";
  if (startsAt && endsAt <= startsAt) return "ends_at_before_start";
  return null;
}

// grantCapError enforces the tenant "max grant duration" policy. maxGrantDays
// of 0 (or negative/unset) means no cap. Under a cap, a grant must have an end
// date (no permanent access) and its window — from its start (or now if it
// starts immediately) to its end — must not exceed the cap. Pure + db-free.
export function grantCapError(
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
  maxGrantDays: number,
): string | null {
  if (!maxGrantDays || maxGrantDays <= 0) return null;
  if (!endsAt) return "grant_requires_end";
  const start = startsAt ?? now;
  const maxMs = maxGrantDays * 24 * 60 * 60 * 1000;
  if (endsAt.getTime() - start.getTime() > maxMs) return "grant_exceeds_max";
  return null;
}
