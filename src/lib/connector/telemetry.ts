export interface ConnectorTelemetry {
  version: string;
  uptimeSec: number;
  activeConnections: number;
  totalConnections: number;
  deniedCount: number;
  bytesIn: number;
  bytesOut: number;
  recentLogs?: string[];
  guacdLogs?: string[];
}

// Reads a connector's live telemetry from the data-plane (in-memory, ephemeral).
// Fail-soft: an unreachable data-plane returns { online: false } so the page still
// renders its DB fields.
export async function getConnectorTelemetry(
  connectorId: string,
): Promise<{ online: boolean; ageMs?: number; telemetry?: ConnectorTelemetry | null }> {
  const base = process.env.DATAPLANE_URL || "http://access-dataplane:3102";
  const secret = process.env.DATAPLANE_SECRET || "";
  const res = await fetch(`${base}/connector-telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": secret },
    body: JSON.stringify({ connectorId }),
  }).catch(() => null);
  if (!res || !res.ok) return { online: false };
  return res.json();
}
