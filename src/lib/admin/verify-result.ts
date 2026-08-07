// Map a connection-test outcome to the persisted lastVerified* columns.
// On success the detail is always cleared. Pure + db-free (vitest node env).
export function verifyResultFields(
  ok: boolean,
  detail: string | null,
  now: Date,
): { lastVerifiedAt: Date; lastVerifiedOk: boolean; lastVerifiedDetail: string | null } {
  return { lastVerifiedAt: now, lastVerifiedOk: ok, lastVerifiedDetail: ok ? null : detail };
}
