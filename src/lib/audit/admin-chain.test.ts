import { describe, it, expect } from "vitest";
import { stableStringify, canonicalizeAdmin, computeAdminHash, verifyAdminChain, type AdminChainable, type AdminStored } from "./admin-chain";

function chainable(seq: bigint, over: Partial<AdminChainable> = {}): AdminChainable {
  return {
    seq, timestamp: new Date("2026-08-13T00:00:00Z"), actorId: "a1", actorEmail: "a@x.co",
    action: "grant.revoke", targetType: "grant", targetId: "g1", summary: "Revoked grant g1",
    metadata: null, clientIp: "1.2.3.4", ...over,
  };
}
function chained(items: AdminChainable[]): AdminStored[] {
  let prev = "";
  return items.map((e) => { const hash = computeAdminHash(prev, e); const row = { ...e, prevHash: prev, hash }; prev = hash; return row; });
}

describe("stableStringify", () => {
  it("sorts keys and is order-independent", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("handles null, arrays, nesting", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]');
  });
});

describe("canonicalizeAdmin", () => {
  it("is stable regardless of metadata key order", () => {
    const a = canonicalizeAdmin(chainable(1n, { metadata: { userId: "u", siteId: "s" } }));
    const b = canonicalizeAdmin(chainable(1n, { metadata: { siteId: "s", userId: "u" } }));
    expect(a).toBe(b);
  });
});

describe("verifyAdminChain", () => {
  it("empty → ok", () => expect(verifyAdminChain([]).ok).toBe(true));
  it("intact chain → ok, head matches", () => {
    const rows = chained([chainable(1n), chainable(2n), chainable(3n)]);
    const head = { lastSeq: 3n, lastHash: rows[2].hash };
    expect(verifyAdminChain(rows, head)).toMatchObject({ ok: true, count: 3, reason: null });
  });
  it("altered field → hash_mismatch", () => {
    const rows = chained([chainable(1n), chainable(2n)]);
    rows[1] = { ...rows[1], summary: "tampered" };
    expect(verifyAdminChain(rows).reason).toBe("hash_mismatch");
  });
  it("interior delete → prev_hash_mismatch", () => {
    const rows = chained([chainable(1n), chainable(2n), chainable(3n)]);
    expect(verifyAdminChain([rows[0], rows[2]]).reason).toBe("prev_hash_mismatch");
  });
  it("tail truncation → head_mismatch", () => {
    const rows = chained([chainable(1n), chainable(2n), chainable(3n)]);
    const head = { lastSeq: 3n, lastHash: rows[2].hash };
    expect(verifyAdminChain([rows[0], rows[1]], head).reason).toBe("head_mismatch");
  });
});
