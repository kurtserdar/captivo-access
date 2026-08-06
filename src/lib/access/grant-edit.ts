// Validate an edit to a grant's end date. Returns an error code, or null if valid.
// Pure + db-free so it unit-tests in the vitest node env.
export function grantEndsAtError(endsAt: Date, startsAt: Date | null, now: Date): string | null {
  if (Number.isNaN(endsAt.getTime())) return "invalid_ends_at";
  if (endsAt <= now) return "ends_at_in_past";
  if (startsAt && endsAt <= startsAt) return "ends_at_before_start";
  return null;
}
