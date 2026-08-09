// Pushes an egress policy to the connector's live control stream via the
// data-plane. Fail-soft — an offline/unreachable connector is not an error; the
// policy is applied on the connector's next connect (via the status response).
export async function pushConnectorPolicy(
  connectorId: string,
  egressAllowedTargets: string,
): Promise<{ ok: boolean; reason?: string }> {
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  const res = await fetch(`${base}/connector-policy`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify({ connectorId, egressAllowedTargets }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, reason: "unreachable" };
  return res.json();
}
