// Parse the fields we care about from GitHub's releases/latest JSON: the release
// version (leading "v" stripped, must be a plain semver) and the release page URL.
export function parseLatestRelease(body: unknown): { latestVersion: string | null; latestUrl: string | null } {
  if (!body || typeof body !== "object") return { latestVersion: null, latestUrl: null };
  const o = body as Record<string, unknown>;
  const tag = typeof o.tag_name === "string" ? o.tag_name.trim().replace(/^v/i, "") : "";
  const url = typeof o.html_url === "string" ? o.html_url : null;
  return { latestVersion: /^\d+\.\d+\.\d+/.test(tag) ? tag : null, latestUrl: url };
}
