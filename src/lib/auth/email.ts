// Canonical email form for storage + lookup: trimmed + lowercased. Keeps
// User.email @unique effective against case variants (matches SSO, which
// already lowercases claim emails).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
