# External Anchor (RFC 3161) — Design

**Date:** 2026-08-10
**Status:** Approved for planning
**Area:** Tamper-evidence / audit integrity

## Problem

The audit log is a SHA-256 hash chain: each `AuditEvent` carries `seq`, `prevHash`,
and `hash`, where `hash = sha256(prevHash + "\n" + canonicalize(event))`. The chain
head lives in the `AuditChainState` singleton (`lastSeq`, `lastHash`). `verifyChain`
detects three failures: content tampering (hash mismatch), adjacency breaks
(prevHash mismatch), and tail truncation (head mismatch).

All of this lives in one Postgres database. An attacker with full DB/server
control can alter or delete events, recompute the **entire** chain, and update
`AuditChainState` to match — the internal verification then reports "OK". There is
no independent witness to the chain's state over time.

**External anchoring closes this gap:** periodically publish the chain head to an
independent source the server administrator cannot retroactively rewrite. A stored
timestamp from the past pins what the head *was* at that time, so a later full
rewrite can no longer be back-dated without also forging the external anchor.

## Scope

- **In scope:** anchoring the **audit** hash chain.
- **Out of scope:** recording integrity. Recordings have no hash chain today
  (`RecordingChunk` has no hash field); adding one is a separate, larger effort.
  If pursued later, its head could be anchored by the same mechanism.
- **Unchanged components:** data-plane and connector are not touched. This is a
  manager + database + cron change.

## Anchor target: RFC 3161 Time-Stamp Authority

The head is timestamped by a standard RFC 3161 TSA. Rationale: standards-based and
legally recognized; low latency; works with any TSA (a public one such as
freeTSA.org, a commercial one, or the customer's own); independently verifiable
with off-the-shelf tools (`openssl ts`). This mirrors the timestamping approach the
main Captivo product already relies on.

## Key decisions (approved)

1. **Opt-in, off by default.** No anchoring happens until an admin enables it.
2. **No bundled TSA.** The TSA URL is empty by default; the customer enters their
   chosen TSA. Enabling anchoring without a TSA URL is a validation error.
3. **Daily cadence.** Anchoring runs once per day via the existing external-cron
   pattern (host crontab / `deploy/setup.sh`). Operators may schedule it more often.

## Data model

New table `AuditAnchor` — one row per successful anchor:

```prisma
model AuditAnchor {
  id           String   @id @default(cuid())
  anchoredSeq  BigInt                        // head seq at anchor time
  anchoredHash String                        // head hash at anchor time
  tsaUrl       String                        // TSA that issued the token
  token        Bytes                         // DER-encoded RFC 3161 TimeStampToken
  genTime      DateTime                      // genTime parsed from the token
  createdAt    DateTime @default(now())

  @@index([anchoredSeq])
  @@index([createdAt])
}
```

Failures are **not** stored as rows; they are logged and surfaced via the last-run
state (see Cron). Storing only successful anchors keeps the table meaningful — every
row is a valid, verifiable proof.

Settings live in the existing platform-settings layer (`env → DB → default`),
following the same pattern as other `/admin/policy` settings:

- `externalAnchorEnabled: boolean` (default `false`)
- `anchorTsaUrl: string` (default `""`)
- `anchorTsaAuth: string` (default `""`) — optional `user:pass` for TSAs behind
  HTTP Basic auth; blank means none.

## Anchoring flow (cron)

New endpoint `POST /api/cron/audit-anchor`, Bearer-authenticated with `CRON_SECRET`,
consistent with the other cron endpoints. On each run:

1. If `externalAnchorEnabled` is false or `anchorTsaUrl` is blank → no-op, return a
   "disabled" status.
2. Read the head from `AuditChainState` (`lastSeq`, `lastHash`).
3. If `lastSeq === 0` (empty chain) → no-op. If the most recent `AuditAnchor` already
   has `anchoredSeq === lastSeq` and `anchoredHash === lastHash` → skip (head
   unchanged since last anchor; no duplicate proofs).
4. Compute the anchored digest: `sha256(utf8(anchoredSeq + ":" + anchoredHash))`.
   The `seq:hash` binding ties the proof to a specific chain position, not just a
   bare hash value.
5. Build an RFC 3161 `TimeStampReq` over that digest (SHA-256, `certReq = true` so
   the TSA cert is embedded for later verification), POST it to `anchorTsaUrl`
   (`Content-Type: application/timestamp-query`), with Basic auth if configured.
6. Parse the `TimeStampResp`. On PKIStatus `granted`/`grantedWithMods`, extract the
   `TimeStampToken` and its `genTime`; insert an `AuditAnchor` row.
7. **Any failure** (network, non-granted status, parse error) is logged and returned
   in the run status; the run does **not** throw and **never** blocks audit ingest.
   The next scheduled run retries automatically.

The endpoint records a `CronRun` heartbeat (job key `audit-anchor`) on each run so
operators can see it is alive. **Because anchoring is opt-in, the policy page's
"scheduled jobs look stopped" warning for `audit-anchor` is gated on
`externalAnchorEnabled`** — a disabled feature must never raise a stale-job warning.
This requires extending the `CronJob` union and the policy page's job labels/stale
logic to treat `audit-anchor` as conditional on the setting.

## Verification (UI)

Extend the existing `integrity-panel` on `/admin/audit`:

- **Status line:** last anchor — `anchoredSeq`, `genTime`, issuing TSA — and total
  anchor count. If enabled but never anchored, say so.
- **"Verify anchors" action** → `POST /api/admin/audit/anchors/verify`, which for
  each stored `AuditAnchor`:
  1. Verifies the RFC 3161 token: signature valid against the embedded TSA cert, and
     the token's message imprint equals `sha256(anchoredSeq + ":" + anchoredHash)`.
  2. Confirms the anchored head is consistent with the current chain: the event at
     `anchoredSeq` still hashes to `anchoredHash` (for heads still within retention),
     proving no back-dated rewrite of that position. Anchors whose `anchoredSeq` has
     been retention-purged are reported as "beyond retention" (not a failure).
  Returns a per-anchor verdict; the panel renders OK / mismatch counts.
- **Download:** each anchor's token is downloadable as a `.tsr` (DER) via
  `GET /api/admin/audit/anchors/[id]/token`, so an auditor can verify it
  independently with `openssl ts -verify` and the TSA's CA chain. This independent
  verifiability is a core requirement — trust must not terminate at our own UI.

## Library approach

The main product's TSA client (separate repo, Java `tss-client`) is not reusable in
this Node/TypeScript codebase. Use pure-JS ASN.1: `pkijs` + `@peculiar/asn1-schema`
to build the `TimeStampReq`, parse the `TimeStampResp`/`TimeStampToken`, read
`genTime`, and verify the token signature. These are well-maintained, dependency-light,
and OSS-compatible. All ASN.1 handling is isolated in one module
(`src/lib/audit/rfc3161.ts`) with a small, testable interface:

- `buildTimeStampRequest(digest: Buffer): Buffer`
- `parseTimeStampResponse(der: Buffer): { token: Buffer; genTime: Date }` (throws on
  non-granted status)
- `verifyTimeStampToken(token: Buffer, expectedDigest: Buffer): { ok: boolean; genTime: Date; reason?: string }`

## Error handling

- TSA unreachable / TLS / non-granted / malformed response → logged, returned in run
  status, retried next run. Never throws out of the cron handler.
- Enabling anchoring with a blank TSA URL → rejected at settings save with a clear
  message.
- Verification of a token that fails signature or digest check → reported as a
  mismatch in the panel, never a server error.

## Testing

Following the existing `chain.test.ts` / `verify.test.ts` style (pure units, no live
network):

- `rfc3161` module: build a request and assert its DER structure; parse a **fixture**
  `TimeStampResp` (committed test vector) and assert `genTime` + token extraction;
  verify a fixture token against the correct and an incorrect digest.
- Cron logic (pure part): head-unchanged → skip; empty chain → no-op; disabled → no-op.
- Verify logic: anchored hash matches chain event → OK; altered event → mismatch;
  retention-purged seq → "beyond retention".

TSA network calls are not unit-tested against a live server; the HTTP boundary is thin
and exercised manually against a real TSA during rollout.

## Deployment

- Prisma `db push` adds `AuditAnchor` (migrate one-shot at deploy).
- New platform-settings columns added the same way.
- Manager image bump; new cron endpoint. Add `audit-anchor` to the host crontab and
  `deploy/setup.sh` cron installer (daily).
- Data-plane and connector unchanged.
