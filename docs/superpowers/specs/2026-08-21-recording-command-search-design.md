# Recording Command Search — Design

**Date:** 2026-08-21
**Status:** Approved (design), pending implementation
**Related:** keystroke timeline (v0.88.0), global keystroke policy (v0.89.0)

## Problem

The keystroke timeline (v0.88.0) captures typed SSH/RDP commands per recording,
searchable *within* one recording's player. There is no way to search *across*
recordings — e.g. "which sessions ran `rm -rf`?" or "who touched
`/etc/passwd`?". The recordings list Search box (`/admin/recordings`) currently
matches only the `host` field.

Add the ability to find recordings by the commands typed inside them.

## Constraint that shapes the design

Keystroke events are stored encrypted at rest: `SessionKeyEvent.data =
encryptBytes(text)` (AES-256-GCM). There is no plaintext command in the
database, so a SQL `LIKE` cannot search them. We will **not** weaken that
(commands are sensitive and can contain secrets). Search happens by decrypting
candidate events in memory and filtering — bounded by a safety cap so it stays
fast and never degrades on a large corpus.

## Goals

- A separate "Search commands" input on `/admin/recordings` that finds
  recordings whose keystroke timeline contains the query substring.
- Encryption preserved; masked events (`••••`, e.g. after `sudo`) never
  searched or leaked.
- Bounded work: on a corpus too large to scan, return a clear "narrow your
  filters" signal instead of a slow/expensive scan.
- Same authorization as the timeline itself (`configure`).

## Non-goals

- No blind-index / HMAC token column (approach B). It scales better but only
  does exact-token matches and needs a schema + tokenization design. If the
  corpus ever grows past the cap in normal use, B can be added later without
  disturbing this design.
- No change to how keystroke events are captured, stored, or displayed.
- No full-text ranking — simple case-insensitive substring match, newest first.

## Design

### Flow (approach A + safety valve)

The command query is a new filter field `cmd`. When present, `listRecordings`
does:

1. **Narrow the candidate set first.** Apply the existing filters
   (`userId` / `siteId` / `from` / `to`) to `SessionRecording` to get the
   candidate recordings, and take only those that actually have keystroke
   events. This is the key that bounds the work: keystroke logging is opt-in per
   gateway resource, so most recordings have zero events and are never scanned.

2. **Cap check.** Count the non-masked `SessionKeyEvent` rows for the candidate
   recordings. If the count exceeds `COMMAND_SCAN_CAP` (50,000), return a
   `narrow` signal — do not scan. The UI shows: *"Too many recordings to search
   by command. Narrow by vendor, resource, or date and try again."*

3. **Decrypt-scan.** Otherwise fetch those events
   (`recordingKey`, `data`, `masked=false`), `decryptBytes` each, and keep the
   `recordingKey`s whose decrypted text contains the query (case-insensitive).
   Masked events are excluded at the query level (`masked: false`), so `••••`
   lines are never decrypted or matched.

4. **List matches.** Return the recordings whose `recordingKey` is in the
   matched set, still honouring the other filters + paging + `host` `q` if both
   are set (AND semantics).

`cmd` and the existing `q` (host) are independent inputs combined with AND.

### Where the logic lives

- `src/lib/recording/filter.ts`: add `cmd?: string` to `RecordingFilter` and
  parse it in `parseRecordingFilter`. `buildRecordingWhere` is unchanged (the
  command match can't be expressed as a Prisma `where`); `cmd` is handled in the
  query layer.
- `src/lib/recording/command-search.ts` (new): the decrypt-scan, isolated and
  unit-testable.
  - `const COMMAND_SCAN_CAP = 50_000;`
  - `export type CommandScan = { kind: "ok"; recordingKeys: Set<string> } | { kind: "too_broad" };`
  - `export async function matchRecordingKeysByCommand(candidateRecordingKeys: string[], query: string): Promise<CommandScan>` —
    counts non-masked events for the candidates; returns `too_broad` if over the
    cap; else decrypts and returns the matching `recordingKey` set.
  - A pure helper `commandTextMatches(decrypted: string, query: string): boolean`
    (case-insensitive substring) is the unit-tested core.
- `src/lib/recording/query.ts`: when `filter.cmd` is set, run the two-phase
  flow (candidate recordingKeys → `matchRecordingKeysByCommand` → final list).
  On `too_broad`, `listRecordings` returns a sentinel so the route can surface
  it (e.g. `{ rows: [], total: 0, tooBroad: true }`).

### API

`src/app/api/admin/recordings/route.ts` (already `configure`-gated): parse `cmd`
via the updated `parseRecordingFilter`, pass through, and include `tooBroad` in
the JSON response when set. No new route.

### UI

`src/app/(app)/admin/recordings/recordings-table.tsx`:

- Add a second search input labelled **"Search commands"** next to the existing
  host Search, placeholder `e.g. rm -rf, systemctl…`, wired to a new `cmd`
  filter with the same 300 ms debounce.
- When the response has `tooBroad: true`, render an inline notice in the table
  area: *"Too many recordings to search by command — narrow by vendor,
  resource, or date."* instead of rows.
- Optional nicety (include): a small hint under the command field —
  *"Searches typed commands in recorded gateway sessions. Masked entries
  (passwords) are never searched."*

### Authorization

Unchanged: the list route requires `configure`, exactly like the per-recording
keyevents read. Roles below `configure` (AUDITOR) already cannot open the
timeline, so they get no command-search capability either — consistent.

## Testing

- `commandTextMatches`: case-insensitivity, substring, empty query, no match.
- `matchRecordingKeysByCommand` (with a test DB row set or a thin mock over the
  event fetch): returns matching keys; excludes masked events; returns
  `too_broad` when the candidate event count exceeds the cap.
- `parseRecordingFilter`: `cmd` parsed and trimmed; absent → undefined.
- Reuse the test env's `ENCRYPTION_KEY = "0".repeat(64)` for encrypt/decrypt
  round-trips in the scan test.

## Rollout

- Manager-only change (no schema, no dataplane, no connector). No `db push`.
- Ship as its own release tag; English user-facing release note ("search
  recordings by the commands typed inside them").
- Deploy is a separate, explicitly-approved step.

## Future (only if needed)

If a deployment routinely trips the cap, add approach B (an HMAC blind-index
column on `SessionKeyEvent`, populated at ingest, queried by `HMAC(token)`) as a
fast pre-filter that narrows candidates before the decrypt-scan. It composes
with this design rather than replacing it.
