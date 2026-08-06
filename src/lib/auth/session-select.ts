// Which requested session ids may actually be revoked in bulk: never the
// caller's own current session (prevents self-lockout), never falsy entries.
// Pure + db-free so it unit-tests in the vitest node env.
export function sessionIdsToRevoke(requested: string[], currentId: string | null): string[] {
  return requested.filter((id) => typeof id === "string" && id !== "" && id !== currentId);
}
