import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connector/dataplane", () => ({ probeConnector: vi.fn() }));
import { probeConnector } from "@/lib/connector/dataplane";
import { probeSite } from "./health";

const mockProbe = probeConnector as unknown as ReturnType<typeof vi.fn>;

describe("probeSite", () => {
  beforeEach(() => mockProbe.mockReset());

  it("maps a successful TCP connect to reachable with latency", async () => {
    mockProbe.mockResolvedValue({ ok: true, latencyMs: 12 });
    expect(await probeSite({ connectorId: "c", upstreamUrl: "http://x:8080" })).toEqual({
      probeOk: true,
      probeDetail: "reachable",
      probeLatencyMs: 12,
    });
  });

  it("maps a probe error to unreachable with null latency", async () => {
    mockProbe.mockResolvedValue({ error: "connection refused" });
    expect(await probeSite({ connectorId: "c", upstreamUrl: "http://x:8080" })).toEqual({
      probeOk: false,
      probeDetail: "connection refused",
      probeLatencyMs: null,
    });
  });
});
