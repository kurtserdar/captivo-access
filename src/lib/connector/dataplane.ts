// Control-plane client for the data-plane's internal /proxy API. Used to
// round-trip an HTTP request through a connector's tunnel (e.g. the
// admin "test connection" button) without the Manager ever dialing the
// customer's network directly.
export async function proxyThroughConnector(input: {
  connectorId: string;
  upstreamUrl: string;
  method?: string;
  path?: string;
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
    }),
  }).catch(() => null);
  if (!res) return { error: "dataplane_unreachable" };
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? "proxy_failed" };
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
