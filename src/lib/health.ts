/** Manager health summary — pure function for /api/health and compose/CI smoke tests. */
export function getHealth(): { status: "ok"; version: string } {
  return { status: "ok", version: process.env.npm_package_version ?? "0.0.0" };
}
