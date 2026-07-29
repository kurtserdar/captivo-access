import { describe, it, expect } from "vitest";
import { canonicalize, computeHash, GENESIS_PREV_HASH, type ChainableEvent } from "./chain";

const base: ChainableEvent = {
  seq: 1n,
  timestamp: new Date("2026-01-02T03:04:05.000Z"),
  userId: "u1", siteId: "s1",
  host: "app.internal", method: "GET", path: "/x",
  status: 200, bytesOut: 123n, decision: "ALLOW",
  reason: null, clientIp: "10.0.0.1", userAgent: "curl/8",
};

describe("canonicalize", () => {
  it("is deterministic and uses the frozen field order", () => {
    const US = "\x1f";
    expect(canonicalize(base)).toBe(
      ["1", "2026-01-02T03:04:05.000Z", "u1", "s1", "app.internal", "GET", "/x", "200", "123", "ALLOW", "", "10.0.0.1", "curl/8"].join(US),
    );
  });
  it("maps null fields to empty strings", () => {
    const e = { ...base, userId: null, siteId: null, reason: null, clientIp: null, userAgent: null };
    const parts = canonicalize(e).split("\x1f");
    expect(parts[2]).toBe(""); // userId
    expect(parts[3]).toBe(""); // siteId
    expect(parts[10]).toBe(""); // reason
    expect(parts[11]).toBe(""); // clientIp
    expect(parts[12]).toBe(""); // userAgent
  });
});

describe("computeHash", () => {
  it("returns a 64-char hex sha256", () => {
    const h = computeHash(GENESIS_PREV_HASH, base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when any field changes", () => {
    const a = computeHash(GENESIS_PREV_HASH, base);
    const b = computeHash(GENESIS_PREV_HASH, { ...base, path: "/y" });
    expect(a).not.toBe(b);
  });
  it("changes when prevHash changes (chaining)", () => {
    const a = computeHash(GENESIS_PREV_HASH, base);
    const b = computeHash("deadbeef", base);
    expect(a).not.toBe(b);
  });
});
