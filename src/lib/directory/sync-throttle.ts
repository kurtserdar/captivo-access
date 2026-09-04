// Login-time directory-sync throttle. The passkey/OIDC login path resolves the
// user against AD (a live LDAP bind + subtree search through the connector)
// before issuing the session. That call can be slow, so we skip it when the
// user was verified against AD within a recent window — bounding per-login
// latency without dropping enforcement (a removed AD user is still caught on
// the next resolve after the window elapses).

// Throttle window in ms. Env DIRECTORY_SYNC_THROTTLE_SECONDS overrides; 0
// disables (resolve on every login). Default 5 minutes.
export function directorySyncThrottleMs(): number {
  const raw = process.env.DIRECTORY_SYNC_THROTTLE_SECONDS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) * 1000 : 300_000;
}

// True when the user was verified against AD recently enough to skip this
// login's resolve. Never skips when throttling is disabled or the user was
// never verified.
export function shouldSkipSync(
  lastVerifiedAt: Date | null | undefined,
  now: number,
  throttleMs: number,
): boolean {
  if (throttleMs <= 0) return false;
  const last = lastVerifiedAt?.getTime() ?? 0;
  return last > 0 && now - last < throttleMs;
}
