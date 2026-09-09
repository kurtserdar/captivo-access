// A user's display name as typed into a form: trimmed, inner whitespace
// collapsed, 1–100 chars. Null when absent or unusable (callers fall back or 400).
export const DISPLAY_NAME_MAX = 100;

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, " ").trim();
  if (!v || v.length > DISPLAY_NAME_MAX) return null;
  return v;
}

// An invite whose name is just the invitee's email (e.g. a tenant's first admin,
// provisioned by the platform with only an address) has no real name yet — the
// enrollment form should ask for one instead of prefilling the address.
export function isPlaceholderName(name: string, email: string): boolean {
  return name.trim().toLowerCase() === email.trim().toLowerCase();
}
