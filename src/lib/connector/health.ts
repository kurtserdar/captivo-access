import { probeConnector } from "@/lib/connector/dataplane";

export type ProbeResult = { probeOk: boolean; probeDetail: string; probeLatencyMs: number | null };

// Probe a Site's reachability with a raw TCP connect through its connector,
// timing the round trip. A successful connect (regardless of what protocol
// the upstream speaks) means the connector reached it; a probe error means
// it did not, and the error string is the reason.
export async function probeSite(site: { connectorId: string; upstreamUrl: string }): Promise<ProbeResult> {
  const res = await probeConnector({ connectorId: site.connectorId, upstreamUrl: site.upstreamUrl });
  if ("error" in res) return { probeOk: false, probeDetail: res.error, probeLatencyMs: null };
  return { probeOk: true, probeDetail: "reachable", probeLatencyMs: res.latencyMs };
}

// Build the probe URL for a gateway target. The scheme only satisfies the
// connector's URL parser; the probe is a raw TCP connect to host:port and never
// makes an HTTP request. IPv6 hosts are bracketed.
export function gatewayProbeUrl(targetHost: string, targetPort: number): string {
  const host = targetHost.includes(":") ? `[${targetHost}]` : targetHost;
  return `http://${host}:${targetPort}`;
}

// Probe a GATEWAY site's target (RDP/SSH/VNC host:port) with a raw TCP connect
// through its connector, timing the round trip — the same mechanism used for a
// web-app site's upstream.
export async function probeGatewaySite(site: { connectorId: string; targetHost: string; targetPort: number }): Promise<ProbeResult> {
  const res = await probeConnector({ connectorId: site.connectorId, upstreamUrl: gatewayProbeUrl(site.targetHost, site.targetPort) });
  if ("error" in res) return { probeOk: false, probeDetail: res.error, probeLatencyMs: null };
  return { probeOk: true, probeDetail: "reachable", probeLatencyMs: res.latencyMs };
}
