import { computeHash, GENESIS_PREV_HASH, type ChainableEvent } from "./chain";

export type StoredEvent = ChainableEvent & { prevHash: string; hash: string };

export type ChainVerifyResult = {
  ok: boolean;
  count: number;
  firstSeq: string | null;
  lastSeq: string | null;
  retentionBoundary: boolean;
  brokenAtSeq: string | null;
  reason: "hash_mismatch" | "prev_hash_mismatch" | null;
};

// Verify an array of events already ordered by seq ascending. Pure — the
// DB paging lives in the route so this is unit-testable.
export function verifyChain(events: StoredEvent[]): ChainVerifyResult {
  if (events.length === 0) {
    return { ok: true, count: 0, firstSeq: null, lastSeq: null, retentionBoundary: false, brokenAtSeq: null, reason: null };
  }

  const first = events[0];
  // The first remaining event's prevHash either is genesis ("") or points to a
  // retention-purged predecessor — both are valid chain starts, not breaks.
  const retentionBoundary = first.prevHash !== GENESIS_PREV_HASH;

  let prevHash: string | null = null; // null until we have a real predecessor to compare against
  for (const e of events) {
    // 1) The stored hash must recompute from the stored prevHash + content.
    if (computeHash(e.prevHash, e) !== e.hash) {
      return { ok: false, count: events.length, firstSeq: events[0].seq.toString(), lastSeq: events[events.length - 1].seq.toString(), retentionBoundary, brokenAtSeq: e.seq.toString(), reason: "hash_mismatch" };
    }
    // 2) Adjacency: this event's prevHash must equal the previous event's hash.
    if (prevHash !== null && e.prevHash !== prevHash) {
      return { ok: false, count: events.length, firstSeq: events[0].seq.toString(), lastSeq: events[events.length - 1].seq.toString(), retentionBoundary, brokenAtSeq: e.seq.toString(), reason: "prev_hash_mismatch" };
    }
    prevHash = e.hash;
  }

  return {
    ok: true,
    count: events.length,
    firstSeq: events[0].seq.toString(),
    lastSeq: events[events.length - 1].seq.toString(),
    retentionBoundary,
    brokenAtSeq: null,
    reason: null,
  };
}
