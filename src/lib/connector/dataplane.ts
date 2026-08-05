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
