// The single capability gate for the credential vault (Pro). Source is
// swappable (env now; license later) — callers must not assume env specifically.
export function vaultEnabled(): boolean {
  const v = process.env.VAULT_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
