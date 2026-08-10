import { db } from "@/lib/db";

// Pushes a connector's full policy (egress narrowing + log level) to its live
// control stream via the data-plane. Reads the current saved values from the DB
// so a caller that changed only one field never clobbers the other. Fail-soft —
// an offline/unreachable connector is not an error; the policy is applied on the
// connector's next connect (via the status response).
export async function pushConnectorPolicy(
  connectorId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const c = await db.connector.findUnique({
    where: { id: connectorId },
    select: { egressPolicy: true, logLevel: true },
  });
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  const res = await fetch(`${base}/connector-policy`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify({
      connectorId,
      egressAllowedTargets: c?.egressPolicy ?? "",
      logLevel: c?.logLevel ?? "info",
    }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, reason: "unreachable" };
  return res.json();
}
