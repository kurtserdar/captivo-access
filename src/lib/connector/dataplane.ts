// Control-plane client for the data-plane's internal /proxy API. Used to
// round-trip an HTTP request through a connector's tunnel (e.g. the
// admin "test connection" button) without the Manager ever dialing the
// customer's network directly.
export async function proxyThroughConnector(input: {
  connectorId: string;
  upstreamUrl: string;
  method?: string;
  path?: string;
  insecureSkipVerify?: boolean;
}): Promise<{ status: number; bodyPreview: string; truncated: boolean } | { error: string }> {
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  const res = await fetch(`${base}/proxy`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify({
      connectorId: input.connectorId,
      upstreamUrl: input.upstreamUrl,
      method: input.method ?? "GET",
      path: input.path ?? "/",
      insecureSkipVerify: input.insecureSkipVerify ?? false,
    }),
  }).catch(() => null);
  if (!res) return { error: "dataplane_unreachable" };
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? "proxy_failed" };
  return res.json();
}

// probeConnector asks the data-plane to open a raw TCP connection to the
// site's upstream through the connector's tunnel and report round-trip
// latency, without issuing an HTTP request. Used for scheduled health checks
// (see health.ts) so probing doesn't depend on the upstream speaking HTTP.
export async function probeConnector(input: {
  connectorId: string;
  upstreamUrl: string;
}): Promise<{ ok: boolean; latencyMs: number } | { error: string }> {
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  const res = await fetch(`${base}/probe`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify({ connectorId: input.connectorId, upstreamUrl: input.upstreamUrl }),
  }).catch(() => null);
  if (!res) return { error: "dataplane_unreachable" };
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? "probe_failed" };
  const data = (await res.json()) as { ok: boolean; latencyMs: number; error?: string };
  if (!data.ok) return { error: data.error || "unreachable" };
  return { ok: true, latencyMs: data.latencyMs };
}

// testDirectory asks the data-plane to reach the customer's LDAP/AD directory
// through the connector's tunnel and run a bind + base-DN search — the
// enabling round-trip for AD integration. bindPassword is sent cleartext over
// the internal, secret-gated channel (the Manager decrypts it first).
export async function testDirectory(input: {
  connectorId: string;
  host: string;
  port: number;
  security: "PLAIN" | "STARTTLS" | "LDAPS";
  insecureSkipVerify: boolean;
  caCertPem: string;
  baseDN: string;
  bindDN: string;
  bindPassword: string;
}): Promise<{ ok: boolean; baseDnFound?: boolean; error?: string }> {
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  const res = await fetch(`${base}/ldap-test`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify(input),
  }).catch(() => null);
  if (!res) return { ok: false, error: "The data-plane is unreachable." };
  if (!res.ok) return { ok: false, error: "The directory test request failed." };
  return res.json();
}

// Timeout (ms) for the login-time LDAP resolve. Env DIRECTORY_RESOLVE_TIMEOUT_MS
// overrides; floor 500ms. Default 4s — a slow or hung AD/data-plane must never
// stall the login response indefinitely (the caller fails open on timeout).
export function directoryResolveTimeoutMs(): number {
  const raw = process.env.DIRECTORY_RESOLVE_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 500 ? Math.floor(n) : 4000;
}

// resolveDirectoryUser asks the data-plane to look a user up in AD by email
// (bind + subtree search) and return their DN + memberOf group DNs. Used by the
// login-time sync engine. bindPassword is sent cleartext over the internal,
// secret-gated channel (the Manager decrypts it first). A thrown/failed/timed-out
// request surfaces as { error } so the caller can fail open.
export async function resolveDirectoryUser(input: {
  connectorId: string;
  host: string;
  port: number;
  security: "PLAIN" | "STARTTLS" | "LDAPS";
  insecureSkipVerify: boolean;
  caCertPem: string;
  baseDN: string;
  bindDN: string;
  bindPassword: string;
  email: string;
}): Promise<{ found: boolean; dn?: string; memberOf?: string[]; displayName?: string; error?: string }> {
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  const res = await fetch(`${base}/ldap-resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(directoryResolveTimeoutMs()),
  }).catch(() => null);
  if (!res) return { found: false, error: "The directory resolve timed out or the data-plane is unreachable." };
  if (!res.ok) return { found: false, error: "The directory resolve request failed." };
  return res.json();
}

// kickConnector tells the data-plane to close a connector's live yamux
// session immediately (used on revoke, so a currently-connected connector
// doesn't stay proxyable until its next keepalive timeout). Best-effort:
// the data-plane may be briefly unreachable, and the connector is already
// REVOKED in the control plane either way, so any reconnect attempt will
// fail auth on its own.
export async function kickConnector(connectorId: string): Promise<void> {
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  await fetch(`${base}/kick`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify({ connectorId }),
  }).catch(() => {});
}
