// Normalize an admin's optional deny reason: trim, cap at 500 chars, empty/
// non-string → null. Pure + db-free so it unit-tests in the vitest node env.
export function normalizeDenyReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}
