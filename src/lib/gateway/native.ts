// Capability gate for the native HTML5 gateway (Pro). When on, GATEWAY sites open
// the in-Captivo session page instead of the json-auth Guacamole launch. Source
// is swappable (env now; license later). On by default.
import { flagOn } from "@/lib/env-flag";

export function nativeGatewayEnabled(): boolean {
  return flagOn(process.env.NATIVE_GATEWAY, true);
}
