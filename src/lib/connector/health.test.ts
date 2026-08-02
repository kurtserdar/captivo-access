import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connector/dataplane", () => ({ proxyThroughConnector: vi.fn() }));
import { proxyThroughConnector } from "@/lib/connector/dataplane";
import { probeSite } from "./health";

const mockProxy = proxyThroughConnector as unknown as ReturnType<typeof vi.fn>;

describe("probeSite", () => {
  beforeEach(() => mockProxy.mockReset());

  it("maps a status to reachable", async () => {
    mockProxy.mockResolvedValue({ status: 200, bodyPreview: "", truncated: false });
    expect(await probeSite({ connectorId: "c", upstreamUrl: "http://x:8080" })).toEqual({
      probeOk: true,
      probeDetail: "HTTP 200",
    });
  });

  it("treats a 401/403 as reachable (the app answered)", async () => {
    mockProxy.mockResolvedValue({ status: 403, bodyPreview: "", truncated: false });
    expect(await probeSite({ connectorId: "c", upstreamUrl: "http://x:8080" })).toEqual({
      probeOk: true,
      probeDetail: "HTTP 403",
    });
  });

  it("maps a proxy error to unreachable with the reason", async () => {
    mockProxy.mockResolvedValue({ error: "connector offline" });
    expect(await probeSite({ connectorId: "c", upstreamUrl: "http://x:8080" })).toEqual({
      probeOk: false,
      probeDetail: "connector offline",
    });
  });
});
