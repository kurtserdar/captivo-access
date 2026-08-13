// Pure client-side table search: true if the (trimmed, case-insensitive) query is
// a substring of any of the row's human-visible text fields. An empty query
// matches everything. null/undefined fields are skipped.
export function textMatch(fields: (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}
