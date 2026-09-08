// The single capability gate for the credential vault (Pro). Source is
// swappable (env now; license later) — callers must not assume env specifically.
// On by default.
import { flagOn } from "@/lib/env-flag";

export function vaultEnabled(): boolean {
  return flagOn(process.env.VAULT_ENABLED, true);
}
