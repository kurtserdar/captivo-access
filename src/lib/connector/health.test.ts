import { describe, it, expect } from "vitest";
import { gatewayProbeUrl } from "./health";

describe("gatewayProbeUrl", () => {
  it("builds an http URL with the explicit target port", () => {
    expect(gatewayProbeUrl("10.0.0.5", 3389)).toBe("http://10.0.0.5:3389");
  });
  it("works for a hostname target", () => {
    expect(gatewayProbeUrl("rdp.internal", 22)).toBe("http://rdp.internal:22");
  });
  it("brackets an IPv6 target host", () => {
    expect(gatewayProbeUrl("fe80::1", 5900)).toBe("http://[fe80::1]:5900");
  });
});
