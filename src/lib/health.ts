/** Manager sağlık özeti — /api/health ve compose/CI smoke için saf fonksiyon. */
export function getHealth(): { status: "ok"; version: string } {
  return { status: "ok", version: process.env.npm_package_version ?? "0.0.0" };
}
