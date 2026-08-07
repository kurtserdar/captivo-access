// Parse major.minor.patch from a version string, stripping a leading "v" and
// ignoring any pre-release/build suffix. null when it isn't a plain semver.
function parse(v: string | null | undefined): [number, number, number] | null {
  if (!v) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim().replace(/^v/i, ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// -1 if a<b, 0 if equal, 1 if a>b; null if either side isn't a plain semver.
export function compareSemver(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// A connector is outdated when its reported version is strictly older than the manager's.
export function isConnectorOutdated(connectorVersion: string | null | undefined, managerVersion: string): boolean {
  return compareSemver(connectorVersion, managerVersion) === -1;
}

// An update is available when the latest release is strictly newer than the manager's version.
export function isUpdateAvailable(latestVersion: string | null | undefined, managerVersion: string): boolean {
  return compareSemver(latestVersion, managerVersion) === 1;
}
