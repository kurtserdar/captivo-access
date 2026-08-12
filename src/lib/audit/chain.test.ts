import { describe, it, expect } from "vitest";
import { chainHash, computeHash, canonicalize, type ChainableEvent } from "./chain";
import { createHash } from "node:crypto";

const E: ChainableEvent = {
  seq: 5n, timestamp: new Date("2026-08-13T00:00:00Z"), userId: "u", siteId: "s",
  host: "h", method: "GET", path: "/x", status: 200, bytesOut: 10n, decision: "ALLOW",
  reason: null, clientIp: "1.2.3.4", userAgent: "ua",
};

describe("chainHash / computeHash", () => {
  it("chainHash matches raw sha256(prev + \\n + canonical)", () => {
    const canon = "abc";
    expect(chainHash("prev", canon)).toBe(createHash("sha256").update("prev\nabc").digest("hex"));
  });
  it("computeHash is unchanged (= chainHash(prev, canonicalize(e)))", () => {
    expect(computeHash("prev", E)).toBe(chainHash("prev", canonicalize(E)));
  });
});
