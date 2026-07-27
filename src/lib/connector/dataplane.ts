// Control-plane client for the data-plane's internal /proxy API. Used to
// round-trip an HTTP request through a connector's tunnel (e.g. the
// admin "test connection" button) without the Manager ever dialing the
// customer's network directly.
export async function proxyThroughConnector(input: {
  connectorId: string;
  upstreamName: string;
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
      upstreamName: input.upstreamName,
      method: input.method ?? "GET",
      path: input.path ?? "/",
    }),
  }).catch(() => null);
  if (!res) return { error: "dataplane_unreachable" };
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? "proxy_failed" };
  return res.json();
}
