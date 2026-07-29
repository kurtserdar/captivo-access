import { describe, it, expect } from "vitest";
import { computeHash, GENESIS_PREV_HASH, type ChainableEvent } from "./chain";
import { verifyChain, type StoredEvent } from "./verify";

function mk(seq: bigint, path: string): ChainableEvent {
  return {
    seq, timestamp: new Date("2026-01-01T00:00:00.000Z"),
    userId: null, siteId: null, host: "h", method: "GET", path,
    status: 200, bytesOut: 0n, decision: "ALLOW",
    reason: null, clientIp: null, userAgent: null,
  };
}

// Build a valid chain of N events starting from genesis.
function chain(n: number, startPrev = GENESIS_PREV_HASH, startSeq = 1n): StoredEvent[] {
  const out: StoredEvent[] = [];
  let prev = startPrev;
  let seq = startSeq;
  for (let i = 0; i < n; i++) {
    const e = mk(seq, `/p${i}`);
    const hash = computeHash(prev, e);
    out.push({ ...e, prevHash: prev, hash });
    prev = hash;
    seq += 1n;
  }
  return out;
}

describe("verifyChain", () => {
  it("accepts a valid chain from genesis", () => {
    const r = verifyChain(chain(3));
    expect(r.ok).toBe(true);
    expect(r.count).toBe(3);
    expect(r.firstSeq).toBe("1");
    expect(r.lastSeq).toBe("3");
    expect(r.retentionBoundary).toBe(false);
    expect(r.brokenAtSeq).toBe(null);
  });

  it("flags an altered field as hash_mismatch at the tampered seq", () => {
    const c = chain(3);
    c[1] = { ...c[1], path: "/HACKED" }; // stored hash no longer matches content
    const r = verifyChain(c);
    expect(r.ok).toBe(false);
    expect(r.brokenAtSeq).toBe("2");
    expect(r.reason).toBe("hash_mismatch");
  });

  it("flags a deleted interior event as prev_hash_mismatch", () => {
    const c = chain(3);
    const spliced = [c[0], c[2]]; // drop the middle event
    const r = verifyChain(spliced);
    expect(r.ok).toBe(false);
    expect(r.brokenAtSeq).toBe("3");
    expect(r.reason).toBe("prev_hash_mismatch");
  });

  it("treats a retention prefix-delete as ok with retentionBoundary", () => {
    const full = chain(4);
    const suffix = full.slice(2); // events 3,4 — first remaining prevHash points to purged event 2
    const r = verifyChain(suffix);
    expect(r.ok).toBe(true);
    expect(r.retentionBoundary).toBe(true);
    expect(r.firstSeq).toBe("3");
    expect(r.lastSeq).toBe("4");
  });

  it("returns an empty-ok result for no events", () => {
    const r = verifyChain([]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
    expect(r.firstSeq).toBe(null);
    expect(r.lastSeq).toBe(null);
  });
});
