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
