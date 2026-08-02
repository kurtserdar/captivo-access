import { proxyThroughConnector } from "@/lib/connector/dataplane";

export type ProbeResult = { probeOk: boolean; probeDetail: string };

// Probe a Site's reachability by sending GET / through its connector. Any HTTP
// response means the connector reached the app (even 401/403); a proxy error
// means it did not, and the error string is the reason.
export async function probeSite(site: { connectorId: string; upstreamUrl: string }): Promise<ProbeResult> {
  const res = await proxyThroughConnector({
    connectorId: site.connectorId,
    upstreamUrl: site.upstreamUrl,
    method: "GET",
    path: "/",
  });
  if ("error" in res) return { probeOk: false, probeDetail: res.error };
  return { probeOk: true, probeDetail: `HTTP ${res.status}` };
}
