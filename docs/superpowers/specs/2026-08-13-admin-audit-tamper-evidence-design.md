# Admin-Audit Tamper-Evidence (Hash Chain) — Design

**Date:** 2026-08-13
**Status:** Approved (pending spec review)
**Slice:** Add a SHA-256 hash chain + verifier to the `AdminAuditEvent` log, mirroring the access-audit chain. Makes admin-action records tamper-evident.

## Problem

The access/proxy `AuditEvent` log is hash-chained (`chain.ts` + serialized `appendAuditEvents` + `verifyChain` + `IntegrityPanel` + RFC-3161 anchor). The `AdminAuditEvent` log (v0.36/0.37) is plain append-only: `recordAdminAction` does a fire-and-forget `db.adminAuditEvent.create`. A DB-level attacker can alter or delete admin-action rows undetected. This slice chains them.

## Scope

- **In:** a generalized `chainHash`; an `admin-chain.ts` (frozen admin canonicalization, own lock key + head row, `computeAdminHash`, `verifyAdminChain`); schema columns `seq/prevHash/hash` on `AdminAuditEvent`; `recordAdminAction` becomes a **serialized locked append** (still best-effort); a one-time idempotent **backfill** of existing rows; a verify route + an integrity panel on the Admin-actions tab.
- **Out:** RFC-3161 **external anchoring** of the admin chain (a later hardening step — the chain+verify already detects any tamper by an attacker who can't recompute the whole chain; the anchor closes the full-DB-write attacker, exactly as it does for the access chain, and can reuse `AuditAnchor` later); CSV/retention parity.
- **English-only.** Schema change → **migrate**. Deploy = **manager + migrate**, and run the backfill once.

## Architecture

### Generalize the hash primitive (`src/lib/audit/chain.ts`)
Add a low-level, event-agnostic hash:

```ts
export function chainHash(prevHash: string, canonical: string): string {
  return createHash("sha256").update(prevHash + "\n" + canonical).digest("hex");
}
```
Refactor the existing `computeHash(prevHash, e)` to `return chainHash(prevHash, canonicalize(e))` — **byte-identical** to today (same `prevHash + "\n" + canonicalize`), so the access chain and its anchors are unaffected. (A unit test pins this equivalence.)

### Admin chain (`src/lib/audit/admin-chain.ts`, new)
- `ADMIN_AUDIT_CHAIN_LOCK_KEY` — a distinct 64-bit constant (≠ `AUDIT_CHAIN_LOCK_KEY`), so admin appends serialize on their own lock and never block access appends.
- `ADMIN_CHAIN_ID = "admin-singleton"` — the head row id **in the existing `AuditChainState` table** (no new model; access uses `"singleton"`, admin uses `"admin-singleton"`).
- **Frozen canonical order** (`canonicalizeAdmin`): `seq · timestamp(ISO) · actorId · actorEmail · action · targetType · targetId · summary · metadataStable · clientIp`, joined by the same `\x1f` unit separator. `id`/`createdAt` are excluded (DB bookkeeping, like the access chain).
- **`metadataStable`** = a **key-sorted** stable serialization of `metadata` (`stableStringify`), because the `Json`/jsonb column reorders keys on read — a plain `JSON.stringify` would mismatch write vs verify and raise false tamper alarms. `stableStringify(null) === "null"`. This is a small pure helper (tested).
- `computeAdminHash(prevHash, e) = chainHash(prevHash, canonicalizeAdmin(e))`.
- `verifyAdminChain(events, expectedHead?)` — mirrors `verifyChain`: recompute each hash, check `prevHash` adjacency, and (when `expectedHead` given) require the last event's hash to equal the stored head (catches tail-truncation). Returns the same shape as `ChainVerifyResult` (`{ ok, count, firstSeq, lastSeq, brokenAtSeq, reason }`, reason ∈ `hash_mismatch | prev_hash_mismatch | head_mismatch`).

### Schema (`prisma/schema.prisma`)
`AdminAuditEvent` gains:
```prisma
  seq       BigInt?  @unique
  prevHash  String   @default("")
  hash      String   @default("")
```
`seq` is nullable so `db push` can add it to a table that already has rows (Postgres allows multiple NULLs under a unique index); the backfill then fills every existing row, and `recordAdminAction` always sets it going forward. Add `@@index([seq])`. No new model — reuse `AuditChainState`.

### Serialized append (`src/lib/audit/admin.ts`)
`recordAdminAction` changes from a bare `create` to a locked, serialized append (single event), still wrapped in try/catch (best-effort: a failed audit is a **coverage gap**, never a chain break — the chain over successfully-written rows stays valid):

```ts
await db.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_AUDIT_CHAIN_LOCK_KEY})`;
  const head = await tx.auditChainState.upsert({ where: { id: ADMIN_CHAIN_ID }, create: { id: ADMIN_CHAIN_ID }, update: {}, select: { lastSeq: true, lastHash: true } });
  const seq = head.lastSeq + 1n;
  const row = { /* actorId, actorEmail, action, targetType, targetId, summary, metadata, clientIp, timestamp:new Date() */ };
  const hash = computeAdminHash(head.lastHash, { ...row, seq });
  await tx.adminAuditEvent.create({ data: { ...row, seq, prevHash: head.lastHash, hash } });
  await tx.auditChainState.update({ where: { id: ADMIN_CHAIN_ID }, data: { lastSeq: seq, lastHash: hash } });
});
```
`timestamp` is stamped in-code (not the DB default) so the value hashed exactly equals the stored value.

### Backfill (`src/lib/audit/admin-backfill.ts` + `POST /api/admin/audit/admin-backfill`, new)
Idempotent: under the admin lock, load all `AdminAuditEvent` rows with `seq == null` ordered by `createdAt asc, id asc`, continue the chain from the current admin head (genesis if none), assign `seq/prevHash/hash`, and advance the head. A no-op when there are none. Admin-gated (`configure`). Run once after deploy (Gate A).

### Verify route + panel
- `GET /api/admin/audit/admin-verify` (new): `read_console`-gated; loads `AdminAuditEvent` where `seq != null` ordered by `seq asc` + the `"admin-singleton"` head; returns `verifyAdminChain(rows, head)`.
- **`AdminIntegrityPanel`** (new client component) on the Admin-actions tab: a "Verify chain" button → fetches the route → shows ✓ verified (count) or ✗ broken (reason + brokenAtSeq). Simpler than the access panel (no anchor section).

## Testing

- **Unit** (`vitest`): `chain.test.ts` add — `computeHash` output unchanged after the `chainHash` refactor (equivalence pin). `admin-chain.test.ts` — `stableStringify` (sorted keys, nested, null); `canonicalizeAdmin` field order/stability (reordered-metadata → same canonical); `computeAdminHash` determinism; `verifyAdminChain` for ok, `hash_mismatch` (altered field), `prev_hash_mismatch` (interior delete), `head_mismatch` (tail truncation), and empty.
- **Build gate:** `pnpm build`.
- **Manual (Gate A, after deploy + migrate + backfill):** the Admin-actions tab shows ✓ verified; perform a new admin action → still verified, count +1; a direct DB edit of one admin row → verify reports `hash_mismatch` at that seq; deleting the newest row → `head_mismatch`; the access-audit tab + its verify are unchanged.

## Deploy note

Schema change: bump **manager + migrate**, run `docker compose run --rm access-migrate`, then `POST /api/admin/audit/admin-backfill` once (or via the panel). The access chain and anchor are untouched.

## Out of scope (backlog)

- External RFC-3161 anchoring of the admin chain (reuse `AuditAnchor` + the anchor cron for the admin head — a later step).
- Admin-log CSV export / retention parity with the access log.
