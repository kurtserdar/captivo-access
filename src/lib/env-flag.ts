// Parse a boolean capability env var with an explicit default when unset/unknown.
// On: "1" | "true" | "on" | "yes"   Off: "0" | "false" | "off" | "no"
// Anything else (unset, empty, unrecognized) → defaultValue.
export function flagOn(raw: string | undefined, defaultValue: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return defaultValue;
}
