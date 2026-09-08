// Pro capability gate for the isolated-browser (RBI) access mode. On by default.
import { flagOn } from "@/lib/env-flag";

export function isolationEnabled(): boolean {
  return flagOn(process.env.ISOLATED_ENABLED, true);
}
