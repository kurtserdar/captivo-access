// Pro capability gate for the isolated-browser (RBI) access mode. Default OFF.
export function isolationEnabled(): boolean {
  const v = process.env.ISOLATED_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
