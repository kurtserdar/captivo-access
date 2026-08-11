// Capability gate for the native HTML5 gateway (Pro). When on, GATEWAY sites open
// the in-Captivo session page instead of the json-auth Guacamole launch. Source
// is swappable (env now; license later).
export function nativeGatewayEnabled(): boolean {
  const v = process.env.NATIVE_GATEWAY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
