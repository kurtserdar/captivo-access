import { computeHash, GENESIS_PREV_HASH, type ChainableEvent } from "./chain";

export type StoredEvent = ChainableEvent & { prevHash: string; hash: string };

export type ChainHead = { lastSeq: bigint; lastHash: string };

export type ChainVerifyResult = {
  ok: boolean;
  count: number;
  firstSeq: string | null;
  lastSeq: string | null;
  retentionBoundary: boolean;
  brokenAtSeq: string | null;
  reason: "hash_mismatch" | "prev_hash_mismatch" | "head_mismatch" | null;
};

// Verify an array of events already ordered by seq ascending. Pure — the
// DB paging lives in the route so this is unit-testable.
//
// `expectedHead`, when provided, is the AuditChainState singleton head
// (lastSeq/lastHash). Retention only ever deletes a PREFIX of the chain, so
// the last surviving event must always equal the stored head — if it
// doesn't, the tail was truncated (e.g. rows DELETEd without updating the
// head), which a purely internal adjacency/hash check can't detect on its
// own.
export function verifyChain(events: StoredEvent[], expectedHead?: ChainHead): ChainVerifyResult {
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

  // 3) Tail-truncation: the last surviving event must match the stored chain
  // head. An attacker who deletes trailing rows without touching the head
  // leaves an internally-consistent prefix that the checks above can't catch.
  if (expectedHead && events.length > 0) {
    const last = events[events.length - 1];
    if (last.seq !== expectedHead.lastSeq || last.hash !== expectedHead.lastHash) {
      return {
        ok: false,
        count: events.length,
        firstSeq: events[0].seq.toString(),
        lastSeq: last.seq.toString(),
        retentionBoundary,
        brokenAtSeq: last.seq.toString(),
        reason: "head_mismatch",
      };
    }
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
