# Gateway v2 — Slice C1: native remote-desktop session recording

**Status:** approved design (2026-08-11)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Follows:** GW-A (unified site model), GW-B (bundled guacd, native-only gateway)
**Followed by:** GW-C2 (live view of active sessions) — out of scope here

## Goal

Record native gateway sessions (RDP/SSH/VNC) so admins can replay them later
in the console. Capture the session by teeing the guacd→browser instruction
stream in the data-plane, store it encrypted and gzipped in Postgres (reusing
the existing recording tables with a format discriminator), gate it behind the
same `RECORDING_ENABLED` capability + per-site `recordSessions` toggle, respect
the existing `recordingConsentRequired` platform setting before connecting, and
replay it with `Guacamole.SessionRecording` on the admin recordings page.

## Why tee, not guacd's recording-path

guacd runs on the **connector host** (GW-B bundles it there so the connector can
reach the RDP/SSH/VNC target on its own LAN). guacd's own `recording-path` would
therefore write the file on that remote host, stranded from the manager, and
only complete at session end. The data-plane, by contrast, already relays the
full guacd→browser instruction stream **on the manager host** (`serveGuacTunnel`
in `dataplane/guactunnel.go`), and the existing `internal/recording/ingest`
endpoint already accepts recording chunks from the data-plane over
`DATAPLANE_SECRET`. A Guacamole session recording *is* the client-bound
instruction stream (with `sync` instructions carrying the timeline), so teeing
that stream produces a valid, `Guacamole.SessionRecording`-replayable recording
with no cross-host file retrieval, no guacd config change, and full reuse of the
existing storage / retention / deletion / audit pipeline.

## Non-goals (C1)

- **Live view of active sessions** — watching an in-progress session in
  real time (GW-C2). C1 replays sessions after they end. Opening a recording
  whose session is still live simply replays what has been flushed so far.
- **guacenc → mp4 export.** The stored stream can be converted later if needed;
  not built now.
- **Audio capture.** guacd can stream audio and it would ride the same tee, but
  RDP audio is off by default and it is not wired in C1.
- **Retro-encrypting existing rrweb recordings.** C1 adds at-rest encryption for
  new native recordings and leaves the read path able to serve old plaintext
  rrweb chunks unchanged. Encrypting rrweb too is a later, independent change.
- **Per-connector data residency.** Recordings are centralized in the manager's
  Postgres (the customer-controlled, single-data-controller store). Keeping a
  recording at the connector's location (a different jurisdiction / controller)
  is a rare advanced case deferred to a future slice.

## Architecture

```
browser (guacamole-common-js)
   │  WSS  (input up / display down)
   ▼
data-plane  serveGuacTunnel ──tee──► recWriter ──HTTP POST (DATAPLANE_SECRET)──► manager
   │  guac protocol                                   /api/internal/recording/ingest-guac
   │  (over connector yamux)                                │ encryptBytes(gzip(rawGuac))
   ▼                                                        ▼
connector → guacd (captivo-guacd:4822)              Postgres: SessionRecording(format=GUAC)
   │                                                          + RecordingChunk(data=enc)
   ▼
RDP/SSH/VNC target

admin ──► /admin/recordings/[id] ──► GET .../guac ──► assembleGuac (decrypt+gunzip+concat)
                                        │ Blob
                                        ▼
                              Guacamole.SessionRecording (play/seek)
```

## Components

### 1. Data model (`prisma/schema.prisma`)

Extend the existing recording tables — no new tables.

```prisma
enum RecordingFormat {
  RRWEB
  GUAC
}

model SessionRecording {
  // ... existing fields ...
  format    RecordingFormat @default(RRWEB)
  protocol  String?         // "rdp" | "ssh" | "vnc" for GUAC; null for RRWEB
  encrypted Boolean         @default(false) // true → chunks are encryptBytes(gzip(..))
}
```

- Existing rrweb recordings keep `format=RRWEB, encrypted=false` — the read path
  branches on these, so nothing legacy breaks.
- `RecordingChunk` is unchanged; `data Bytes` now holds
  `encryptBytes(gzip(rawGuacBytes))` for GUAC recordings.
- Schema is applied with `prisma db push` (no migrations in this project).
  Deploy must bump BOTH the manager and the migrate image and run
  `docker compose run --rm access-migrate`.

### 2. At-rest encryption (`src/lib/crypto.ts`)

Add a Buffer-oriented pair beside the existing string `encrypt`/`decrypt`,
reusing the same AES-256-GCM construction and `DATA_ENCRYPTION_KEY`:

```ts
export function encryptBytes(plaintext: Buffer): Buffer; // iv ‖ tag ‖ ciphertext
export function decryptBytes(payload: Buffer): Buffer;
```

- Same 12-byte random IV + 16-byte GCM tag layout as the string variant, but
  binary in/out (no base64) to avoid inflating chunk size.
- `decryptBytes` throws on auth-tag failure; the ingest/serve paths treat a
  failing chunk as skippable (a corrupt chunk must never break a whole replay).

### 3. Descriptor (`src/app/api/internal/gateway/descriptor/route.ts`)

Add one computed field to the JSON response:

```ts
record: recordingEnabled() && site.recordSessions,
```

- `recordingEnabled()` is the existing `RECORDING_ENABLED` env gate
  (`src/lib/recording/enabled.ts`).
- `site.recordSessions` is the existing per-site boolean (already selected? add
  it to the `select`).
- The data-plane tees iff `record` is true. Consent is handled by the session
  page, not the descriptor.

`ControlClient.GatewayDescriptor` (`dataplane/controlclient.go`) gains a
`Record bool` on its returned descriptor struct and unmarshals the new field.

### 4. Data-plane tee (`dataplane/guactunnel.go` + new `dataplane/guacrecord.go`)

When the descriptor's `record` is true, wrap the guacd→browser copy loop so each
whole instruction (from `readRawInstruction`) is also written to a `recWriter`.

`guacrecord.go`:

```go
type recWriter struct { /* manager URL, secret, key, meta, buffer, seq, total, cap */ }

func newRecWriter(managerURL, secret, recordingKey, siteID, userID, host, protocol string, capBytes int) *recWriter
func (w *recWriter) Write(inst []byte)  // append; flush when buffer ≥ flushBytes or flushInterval elapsed
func (w *recWriter) flush()             // POST one chunk (seq++) to ingest-guac; drop buffer on success
func (w *recWriter) Close()             // final flush
```

- **Flush cadence:** flush a chunk when the buffer reaches `flushBytes`
  (256 KiB) or `flushInterval` (2 s) has elapsed since the last flush, whichever
  comes first.
- **Size cap:** `RECORDING_MAX_BYTES` env (default `524288000` = 500 MiB). When
  the recording's cumulative pre-gzip byte total exceeds the cap, stop teeing,
  log once (`recording site=%s key=%s: size cap reached, stopping capture`), and
  let the session continue uninterrupted.
- **Recording key:** generated in Go — `<siteID>-<userID>-<unixNano>-<rand4hex>`
  (the data-plane is a normal Go process; real time/randomness are available).
- **Failure isolation:** a failed ingest POST logs and is retried on the next
  flush with the same seq policy; recording must never break the live session
  (drop the chunk after N failed attempts, keep the session alive).
- Teeing runs on the guacd→browser instruction bytes exactly as forwarded to the
  browser, so the stored stream reproduces the vendor's screen.

### 5. Ingest (`src/app/api/internal/recording/ingest-guac/route.ts`, new)

A sibling of the rrweb `ingest` route so the JSON-events contract stays intact.

Request body (`DATAPLANE_SECRET`-gated via `x-dataplane-secret`):

```ts
{ recordingKey, seq, siteId, userId, host, protocol, data /* base64 raw guac bytes */ }
```

Behavior:
- `if (!dataplaneAuthorized(req)) → 403`; `if (!recordingEnabled()) → 403`.
- Decode `data` (base64 → Buffer), `stored = encryptBytes(gzipSync(raw))`.
- In one `$transaction`: `upsert` `SessionRecording` by `recordingKey`
  (`create` sets `format: "GUAC"`, `encrypted: true`, `protocol`, `host`,
  `userId`, `siteId`, `bytes: stored.length`, `eventCount: 1`; `update`
  increments `bytes`/`eventCount`, sets `lastEventAt`), then `create` a
  `RecordingChunk` with `seq` and `data: stored`.
- Best-effort: never throw to the caller; log and return 500 on unexpected
  error, 204 on success/no-op.

### 6. Assemble + serve

`src/lib/recording/assemble-guac.ts` (new):

```ts
// Sort chunks by seq, decrypt (if encrypted) + gunzip each, concatenate the raw
// guac instruction bytes into one Buffer. A chunk that fails to decode is
// skipped (never break the whole replay).
export function assembleGuac(
  chunks: { seq: number; data: Buffer | Uint8Array }[],
  encrypted: boolean,
): Buffer;
```

`src/app/api/admin/recordings/[id]/guac/route.ts` (new, admin-gated with the
same `can(role, "configure")` guard as the existing recordings API):
- Load the recording + its chunks; `404` if not found or `format !== "GUAC"`.
- Return `assembleGuac(chunks, rec.encrypted)` as `application/octet-stream`.

### 7. Replay UI

- `src/app/(app)/admin/recordings/[id]/page.tsx` — branch on `recording.format`:
  `RRWEB` renders the existing rrweb player; `GUAC` renders
  `<GuacRecordingPlayer recordingId={id} />`.
- `src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx` (new, client):
  fetch `/api/admin/recordings/${id}/guac` as a Blob, construct
  `new Guacamole.SessionRecording(blob)`, mount its `getDisplay().getElement()`,
  and wire play/pause, a seek scrubber bound to the recording's position/duration
  (`onseek`, `onplay`, `onpause`, `onprogress`), and total duration display.
- `src/types/guacamole-common-js.d.ts` — add the `SessionRecording` class
  (constructor `(source: Blob | Tunnel)`, `connect()/disconnect()`, `play()`,
  `pause()`, `seek(ms, cb)`, `getDisplay()`, `getDuration()`, and the
  `onplay/onpause/onseek/onprogress` callbacks used above).
- `src/app/(app)/admin/recordings/recordings-table.tsx` — add a small
  format/protocol badge (e.g. an `RDP`/`SSH`/`VNC` chip for GUAC rows, `WEB` for
  RRWEB) so admins distinguish console from web recordings.

### 8. Consent gate (`src/app/gateway/[siteId]/session/page.tsx`)

The session page is a server component. When
`site.recordSessions && (await resolvedRecordingConsentRequired())` is true,
render a one-screen interstitial ("This session will be recorded for security
and compliance. Continue?") instead of `<GatewaySession>` directly.

- The interstitial is a small client component holding an accept state; on
  accept it renders `<GatewaySession siteId={...} />` (which then connects).
- On accept it also POSTs to a tiny endpoint that writes an audit event
  (`recording.consent.acknowledged`, actor = current user, target = site) —
  cheap, high 5651/KVKK value.
- When the flag is off, the page connects directly (no interstitial) exactly as
  today.

## Data flow (happy path)

1. Vendor opens a Remote desktop site from `/access` → `/gateway/[siteId]/session`.
2. If recording + consent-required: interstitial → accept (audit event) → connect.
3. Browser WS → data-plane `serveGuacTunnel` → descriptor returns `record=true`.
4. Data-plane handshakes guacd, bridges, and tees each guacd→browser instruction
   into `recWriter`.
5. `recWriter` flushes 256 KiB / 2 s chunks to `ingest-guac`; each is
   `encryptBytes(gzip(raw))` in a `RecordingChunk`, `SessionRecording` upserted
   with `format=GUAC`.
6. Session ends → final flush.
7. Admin opens `/admin/recordings/[id]` → GUAC player fetches the assembled Blob
   → `Guacamole.SessionRecording` replays with a working seek bar.
8. Retention cron auto-deletes by `recordingRetentionDays`; manual delete is
   audited — both already exist and cover GUAC rows for free.

## Error handling

- Ingest is best-effort and never throws to the data-plane; a failed chunk is
  logged and dropped, the live session is unaffected.
- A chunk that fails decrypt/gunzip on assemble is skipped, not fatal.
- Size cap stops capture but not the session.
- Recording disabled (`RECORDING_ENABLED` off) → descriptor `record=false`, no
  tee; even a stray POST is rejected 403 by the ingest gate.
- A recording opened while its session is still live replays flushed chunks only
  (acceptable in C1; C2 handles true live view).

## Capability gating

- No new capability env. Native recording shares `RECORDING_ENABLED` +
  per-site `recordSessions`. Encryption uses the existing `DATA_ENCRYPTION_KEY`.
- New tuning env (optional, defaulted): `RECORDING_MAX_BYTES` (500 MiB).

## Testing

**Unit (vitest):**
- `crypto`: `encryptBytes`/`decryptBytes` round-trip; tampered payload throws.
- `assemble-guac`: chunk (encrypt+gzip) → `assembleGuac` decrypt+gunzip+concat
  equals the original byte stream; out-of-order seq is sorted; a corrupt chunk
  is skipped.
- `ingest-guac`: forbidden without secret; disabled → 403; a valid batch upserts
  `format=GUAC, encrypted=true, protocol` and stores an encrypted chunk.

**Unit (Go, `go test ./...` in `dataplane`):**
- `recWriter`: buffers and flushes at `flushBytes`; final `Close` flushes the
  tail; cumulative bytes past the cap stop further flushes; seq increments per
  chunk.

**Gate A (live, operator):**
- `RECORDING_ENABLED=1`, a GATEWAY site with `recordSessions` on: run an RDP
  session, end it, open it in `/admin/recordings` → the GUAC player replays the
  session with a working seek bar and correct duration.
- `recordingConsentRequired` on → the interstitial appears before connect and
  writes the audit event; off → connects directly.
- Recording disabled or access denied → no recording row is created.

## Deploy notes

- Schema change → bump BOTH `access-manager` AND `access-migrate` images and run
  `docker compose run --rm access-migrate` before `up -d access-manager`.
- Data-plane changed (tee) → bump `access-dataplane` too.
- Connector unchanged in C1.
- English-only user-facing strings and release notes (GitHub Release via
  `gh release edit`).

## File map

**Create:**
- `src/app/api/internal/recording/ingest-guac/route.ts`
- `src/app/api/admin/recordings/[id]/guac/route.ts`
- `src/lib/recording/assemble-guac.ts` (+ `.test.ts`)
- `src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx`
- `dataplane/guacrecord.go` (+ `guacrecord_test.go`)

**Modify:**
- `prisma/schema.prisma` (enum + 3 fields)
- `src/lib/crypto.ts` (+ `crypto.test.ts` for the Buffer pair)
- `src/app/api/internal/gateway/descriptor/route.ts` (`record` field + select)
- `dataplane/controlclient.go` (`Record` on descriptor)
- `dataplane/guactunnel.go` (tee wiring)
- `src/app/(app)/admin/recordings/[id]/page.tsx` (format branch)
- `src/app/(app)/admin/recordings/recordings-table.tsx` (format/protocol badge)
- `src/types/guacamole-common-js.d.ts` (`SessionRecording`)
- `src/app/gateway/[siteId]/session/page.tsx` (consent interstitial)
- consent audit endpoint (small `route.ts`) + the interstitial client component
