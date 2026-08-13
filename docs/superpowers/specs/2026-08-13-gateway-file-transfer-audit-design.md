# Gateway File-Transfer Audit Trail — Design

**Status:** Approved (brainstorm 2026-08-13)
**Backlog:** #366
**Ships as:** v0.40.0 (manager + dataplane; **no** migrate, **no** connector rebuild)

## Goal

Give operators a tamper-evident forensic record of every file that moves through
the Guacamole gateway — what left the network (downloads to the vendor's machine)
and what entered it (uploads the vendor pushes in) — including transfers that
start but never finish.

## Decisions (resolved in brainstorm)

1. **Log + source:** the existing **access-audit hash chain**, observed in the
   **data-plane** (Go). Tamper-proof — a vendor cannot suppress or forge it —
   and it reuses the whole existing pipeline (queue → `/api/internal/audit/log`
   → `appendAuditEvents` → frozen chain → verify → RFC-3161 anchor → UI).
2. **Directions:** both upload and download.
3. **Partial transfers:** also recorded — an interrupted transfer is flushed on
   stream abort / session teardown with bytes-seen-so-far.

## Non-negotiable constraint: the access chain is frozen

`src/lib/audit/chain.ts` `canonicalize` is a frozen 13-field function; existing
rows are hash-chained and externally anchored (RFC-3161). **We must not change
`canonicalize`, the field set, `AUDIT_CHAIN_LOCK_KEY`, or the anchor code** — any
of those would invalidate every existing hash and anchor. Therefore the transfer
details must map onto columns that are **already** part of `canonicalize`, so
they are sealed by the hash without altering it. No Prisma schema change.

## Architecture

### Observer (data-plane, new)

A passive observer parses a **copy** of each guac instruction. The forwarding
path stays **byte-identical** — the observer never mutates relayed bytes, so it
cannot corrupt a session (the v0.30.x file-transfer bugs proved the wire must
stay untouched).

Wired into `serveGuacTunnel`'s two existing pumps (`dataplane/guactunnel.go`):

- **guacd → browser** pump already yields whole instructions via
  `readRawInstruction`. Feed a copy to the observer tagged **download**.
- **browser → guacd** pump currently relays raw WS frames. Keep forwarding the
  raw bytes unchanged; additionally feed a copy to the observer tagged
  **upload**. (A single WS text message may concatenate several instructions;
  the observer parses all of them from the copy.)

### State machine

Keyed by `(direction, streamIndex)`. Guac file-transfer opcodes:

| Opcode | Meaning | Args used |
|---|---|---|
| `file` | top-level stream open (SFTP / generic download; also SFTP client upload) | `<idx>, <mimetype>, <filename>` |
| `put` | open a stream **into** a filesystem (RDP drive / SFTP upload) | `<fsIdx>, <idx>, <mimetype>, <filename>` |
| `body` | open a stream **out of** a filesystem (RDP drive / SFTP download) | `<fsIdx>, <idx>, <mimetype>, <filename>` |
| `blob` | payload chunk (base64) | `<idx>, <base64>` |
| `end` | stream complete | `<idx>` |

- On `file`/`put`/`body`: record `{filename, mimetype, direction, bytes: 0, startedAt}`
  under `(direction, idx)`. Direction is fixed by which pump saw it (guacd→browser
  = download, browser→guacd = upload) — **not** by the opcode.
- On `blob,<idx>,<b64>`: add the **decoded** byte count to that stream's tally.
  Decoded length is computed precisely from the base64 string:
  `floor(len*3/4) - padding` where padding = count of trailing `=` (0–2).
- On `end,<idx>`: emit a **completed** event; drop the stream.
- On **teardown** (`serveGuacTunnel` returns, for any reason — vendor
  disconnect, error, admin terminate): flush every still-open stream as a
  **partial** event with bytes-so-far. Teardown is the single catch-all for
  unfinished transfers; the observer does not separately parse `ack`-error or
  `disconnect` opcodes (an aborted stream simply never receives its `end` and is
  swept at teardown).

**Guards (bound cost + memory on the hot path):**
- The observer reads the opcode first and fully processes bytes only for the five
  transfer opcodes and streams it already tracks; all other opcodes (mouse, key,
  img, sync, …) are discarded cheaply.
- A per-session cap on concurrently-tracked open streams (256). Beyond the cap,
  new stream-opens are ignored (logged), so a malicious client opening endless
  `file` streams cannot exhaust memory.
- Any parse error on the copy is swallowed (debug-logged); forwarding continues.
- Filenames longer than 512 chars are truncated in `path`.

### Emit path (unchanged pipeline)

Each finalized transfer is one `AuditEvent` enqueued on the **existing**
`AuditQueue` (bounded, drop-oldest under overload — the documented tradeoff), so
observation never blocks the pump. `RunAuditFlush` → `ctrl.SendAudit` →
`/api/internal/audit/log` → `appendAuditEvents` (serialized locked chain append).

`serveGuacTunnel` must receive the `audit *AuditQueue` (passed from `main.go`,
currently created at `main.go:248` but not handed to the tunnel) and capture
`clientIp`/`userAgent` from the tunnel HTTP request `r` at connect time.

## Storage model — AuditEvent column mapping

Every column below is already in `canonicalize`, so filename, size, and direction
are all inside the tamper-evident hash.

| Column | Value |
|---|---|
| `method` | `DOWNLOAD` / `UPLOAD` / `DOWNLOAD-PARTIAL` / `UPLOAD-PARTIAL` |
| `path` | `/` + filename (truncated to 512) |
| `bytesOut` | decoded byte count (int64, ≥ 0) |
| `host` | session target host (`conn.Hostname`) |
| `decision` | `ALLOW` (a record, never a gate) |
| `reason` | `file:<mimetype>` completed, `file-transfer-aborted` partial |
| `userId` / `siteId` | vendor + site (from the tunnel descriptor) |
| `clientIp` / `userAgent` | vendor's, from the tunnel request |
| `status` | `200` completed, `499` partial/aborted |
| `timestamp` | finalize time |

Manager side needs **no change** to accept these: `normalizeAuditInput` coerces
any `decision ≠ DENY` → `ALLOW`, treats `method`/`path` as free strings, and
clamps `bytesOut ≥ 0`.

**Behavior change to note:** gateway sessions currently emit **no** access-audit
rows (only the browser proxy does). These transfer events will be the first
gateway entries in the Access log — intended and desirable.

## Verb constants (single source of truth)

Define once and reuse (Go + TS mirror the same four strings):
`DOWNLOAD`, `UPLOAD`, `DOWNLOAD-PARTIAL`, `UPLOAD-PARTIAL`.

## UI presentation (manager)

Inline in the existing Access-audit table — one forensic timeline, no new tab.

- **Marker:** when `method` is one of the four transfer verbs, render a badge
  instead of the HTTP method chip — **↓ download** / **↑ upload**; the two
  `*-PARTIAL` verbs use an amber/warning variant. Filename shows in the existing
  `path` column (already searchable via the `q` box); size renders from
  `bytesOut` as it does today.
- **Filter:** one new **"File transfers only"** control that sets `kind=file`.
  Server-side, `kind=file` → `where.method = { in: [the four verbs] }`.
  Added to the pure shared `buildAuditWhere` + `parseAuditFilter`
  (`src/lib/audit/filter.ts`), so both the list route and CSV export honor it.
- A small pure helper `src/lib/audit/access-format.ts` maps a method string to
  `{ isTransfer, direction, partial, label }` for the badge — unit-testable,
  keeps the table component dumb.

## Files

**Data-plane (Go):**
- `dataplane/guacfiletransfer.go` — observer state machine + `AuditEvent`
  construction. Pure enough to unit-test with canned instruction sequences.
- `dataplane/guacfiletransfer_test.go`.
- `dataplane/guactunnel.go` — instantiate the observer, feed both pumps, flush
  on teardown, capture clientIp/userAgent, accept the queue.
- `dataplane/main.go` — pass `audit` into `serveGuacTunnel`.

**Manager (TS):**
- `src/lib/audit/access-format.ts` + `src/lib/audit/access-format.test.ts`.
- `src/lib/audit/filter.ts` — add `kind` to `AuditFilter`, `buildAuditWhere`,
  `parseAuditFilter`; extend `filter.test.ts`.
- `src/lib/audit/query.ts` — `kind` field on `AuditFilter` type.
- `src/app/(app)/admin/audit/audit-table.tsx` — badge + "File transfers only"
  toggle.
- (List route + `export/route.ts` already call `parseAuditFilter`, so they
  inherit `kind` for free — verify, no change expected beyond the shared parse.)

## Testing

**Go (`guacfiletransfer_test.go`):**
- Download via `file` → completed event, correct filename/size/direction.
- Upload via `put` → completed event, direction=upload.
- Download via `body` → completed event.
- Base64 size accuracy: blobs with 0/1/2 `=` padding decode to exact byte counts.
- Partial: open stream, some blobs, no `end`, teardown → `*-PARTIAL`, status 499,
  bytes-so-far.
- Interleaved streams (two concurrent indices) tallied independently.
- Non-transfer opcodes (mouse/key/sync) produce no events.
- Stream cap: > 256 concurrent opens → excess ignored, no OOM, no panic.
- Duplicate/unknown `end` ignored.

**TS:**
- `access-format.test.ts`: each verb → correct badge descriptor; a normal method
  (`GET`) → `isTransfer: false`.
- `filter.test.ts`: `kind=file` → `method in [...]`; absent → no method filter;
  `parseAuditFilter` reads `kind`.

## Deploy

Manager + dataplane images at v0.40.0; `docker compose up -d access-manager
access-dataplane`. **No migrate** (no schema change). **No connector rebuild**
(observer is dataplane-only). Gate-A: perform an RDP-drive upload and a download
in a real session → both appear in the Access log with the right badge, size,
and direction; **Verify chain** on the Access tab stays intact; abort a transfer
mid-file → a `*-PARTIAL` row appears.

## Out of scope

- In-browser file browser / transfer management UI.
- Blocking/quotas on transfers (this is a record, not a gate).
- VNC (no file-transfer channel).
- Content inspection / DLP on the bytes (only metadata is recorded).
