# RBI Transport B (KasmVNC) — High-Fidelity Session Recording Design (B3)

**Date:** 2026-08-14
**Status:** Approved (brainstorm)
**Slice:** RBI B3 — session recording for the high-fidelity isolated browser (the last parity slice before transport A is deleted)

## Goal

Record a high-fidelity (KasmVNC) isolated-browser session as video and play it back
in the existing `/admin/recordings` UI, honoring the site's `recordSessions` toggle
exactly as transport A (guacd) already does. Today the kasm descriptor branch
hardcodes `record: false`, so hi-fi sessions are never recorded.

The recording is a full-fidelity **video** of what the vendor saw (canvas included),
which is the RBI compliance wedge — rrweb DOM recording can't capture canvas/VNC,
and there is no guacd in the hi-fi path to produce a guac-protocol recording.

## Background

- **Transport A records at the data-plane**: `guactunnel.go` tees the guacd→browser
  guac-instruction stream through a `recWriter` (`dataplane/guacrecord.go`) that POSTs
  256 KiB / 2 s chunks to `/api/internal/recording/ingest-guac`, stored as
  `SessionRecording(format=GUAC)` + `RecordingChunk` rows, capped at
  `recordingMaxBytes()` (500 MiB default), best-effort (never blocks the session).
- **Storage + playback already generalize by format**: `RecordingFormat` enum is
  `RRWEB | GUAC`; `SessionRecording`/`RecordingChunk` hold seq-ordered `Bytes`
  chunks; `/admin/recordings/[id]/page.tsx` selects the player by `rec.format`
  (`RRWEB` → `RecordingPlayer`, `GUAC` → `GuacRecordingPlayer`).
- **KasmVNC has no native session recording** (verified: `Xvnc -help` exposes only
  the X RECORD extension and the WebCodecs live-stream codec, not a session-to-file
  recorder), and the kasm image has **no ffmpeg**.
- The hi-fi session is a reverse-proxied KasmVNC WebSocket — no guacd, so A's
  recorder does not apply. The video must be captured in the container and relayed
  to the manager through the connector (the container stays credential-free — it
  never gets manager access).

## Approach (chosen: live streaming, durable)

Capture the per-session Xvnc display with **ffmpeg x11grab → WebM (VP8, ~10 fps)**
inside the kasm container, streamed live so a mid-session crash still keeps
everything captured up to that point (parity with A's live recording).

1. The broker serves the live ffmpeg output at `GET /session/<id>/rec`.
2. The data-plane, on a recorded session, opens that stream through the connector
   relay and forwards WebM chunks to the manager as they arrive — the video-stream
   analog of A's `recWriter`.
3. Storage reuses `SessionRecording`/`RecordingChunk` with a new `VIDEO` format;
   playback adds a `<video>` player.

Rejected: capture-and-upload-on-close (a mid-session crash loses the whole
recording — unacceptable for a compliance artifact); container-direct-upload (would
give the isolated-browser container a manager credential — breaks isolation).

## Components

### 1. `kasm-browser` image

- **Dockerfile**: add `ffmpeg` to the apt install line.
- **Broker (`control.py`)** — new endpoint `GET /session/<id>/rec`:
  - Look up the session's display `:N`. Start
    `ffmpeg -f x11grab -video_size 1280x800 -framerate 10 -i :N -an
     -c:v libvpx -b:v 1M -deadline realtime -f webm -` (stdout, no audio).
  - Stream ffmpeg's stdout to the chunked HTTP response until the client
    disconnects (broken pipe) or the session ends, then terminate ffmpeg.
  - 404 if the session id is unknown. One consumer per session (the data-plane).
  - Recording lifecycle = the `/rec` connection lifecycle; the broker stays
    key-agnostic (it never sees the recordingKey — the data-plane owns that).
- No change to `POST /session` — recording is driven entirely by whether the
  data-plane opens `/rec`.

### 2. Data-plane

- **New file `dataplane/kasmrecord.go`** — `kasmRecWriter`, the video-stream analog of
  `guacrecord.go`'s `recWriter`: buffers incoming WebM bytes to `recFlushBytes` /
  `recFlushInterval`, POSTs base64 chunks to `/api/internal/recording/ingest-video`
  with `{recordingKey, seq, siteId, userId, host, data}`, applies
  `recordingMaxBytes()`, best-effort (a failed POST logs and drops one chunk).
  Independent of `guacrecord.go`/`isolated.go` (transport B must not depend on A).
- **`kasmtunnel.go`** — `kasmDesc` gains `Record bool` (already returned as `record`).
  In `serveKasmTunnel`'s WS-upgrade branch, after the session opens, if
  `d.Record`: spawn a recording goroutine that dials the broker `GET /session/<id>/rec`
  through the connector relay (`dialGuacd`), reads the WebM stream, and feeds it to a
  `kasmRecWriter` (key = `newRecordingKey(siteID, userID)`). Tie the goroutine to the
  WS lifetime: when `proxy.ServeHTTP` returns (WS ended), close the `/rec` relay
  stream so ffmpeg stops and the writer flushes its tail. Reuses `newRecordingKey`
  and `recordingMaxBytes` from `guacrecord.go` (shared helpers, not A-specific logic).

### 3. Manager

- **Descriptor** (`descriptor/route.ts`) kasm branch: replace `record: false` with
  `record: recordingEnabled() && site.recordSessions` (the select already fetches
  `recordSessions`).
- **New ingest endpoint `/api/internal/recording/ingest-video/route.ts`**: mirror
  `ingest-guac` but store raw WebM bytes and set `format: "VIDEO"`, `encrypted: false`.
  DATAPLANE_SECRET-gated, `recordingEnabled()`-gated, upsert `SessionRecording` +
  append `RecordingChunk` (seq, bytes), best-effort (never throws to the data-plane).
- **Schema**: `enum RecordingFormat { RRWEB GUAC VIDEO }` — additive, non-destructive
  `db push`.
- **Playback**: `/admin/recordings/[id]/page.tsx` → `format === "VIDEO"` →
  new **`VideoRecordingPlayer`** client component: fetch the ordered chunks, assemble
  into one `Blob` (`type: "video/webm"`), `<video controls src={URL.createObjectURL(blob)}>`.
  A small internal fetch route streams the assembled chunks for a recording (or
  reuse the existing chunk-fetch path the other players use).

### 4. Unchanged

`SessionRecording`/`RecordingChunk` storage; the recording-retention cron; the
`RECORDING_ENABLED` gate; the site-form recordSessions toggle (already shown for
ISOLATED); the concurrency broker; the clipboard DLP flags (B2).

## Data flow

1. Vendor opens a hi-fi ISOLATED site with `recordSessions = true` →
   descriptor returns `record: true`.
2. WS upgrade → data-plane opens the session, then (record) spawns the recording
   goroutine.
3. Goroutine dials broker `GET /session/<id>/rec` via the connector relay → broker
   starts `ffmpeg x11grab` on `:N` → streams WebM.
4. Goroutine feeds WebM into `kasmRecWriter` → chunked POSTs to
   `/api/internal/recording/ingest-video` → `SessionRecording(VIDEO)` + `RecordingChunk`.
5. Vendor closes → WS ends → goroutine closes `/rec` → ffmpeg stops → tail flushed →
   session torn down (existing `/close`).
6. Admin → `/admin/recordings` → the VIDEO recording plays in `<video>`.

## Error handling / edge cases

- `record = false` → no goroutine, no `/rec` → unchanged behavior.
- ffmpeg fails to start / display missing → `/rec` errors → goroutine logs and gives
  up; the live session continues (recording is best-effort, like A).
- Chunk POST fails → logged, chunk dropped (small gap), session unaffected.
- Size cap (`recordingMaxBytes`) reached → capture stops, session continues (video
  hits the cap sooner than guac — the cap is the backstop).
- Data-plane/session crash mid-session → chunks already posted are retained (that is
  the whole point of live streaming).

## Testing / verification

- **Go** (`dataplane/kasmrecord_test.go`): `kasmRecWriter` buffers to the flush
  threshold and POSTs the expected `ingest-video` body (recordingKey/seq/base64);
  stops at the byte cap.
- **Broker local spike**: build the image, start a session, `GET /session/<id>/rec`,
  read a few seconds, confirm the bytes are a valid WebM (ffprobe/magic bytes) and
  ffmpeg terminates when the connection closes.
- **Manager**: `ingest-video` upserts a `SessionRecording(format=VIDEO)` + chunks;
  `pnpm build` + existing recording tests stay green.
- **Full local spike**: recorded session → WebM captured → stored as chunks →
  assembled Blob plays in a browser `<video>`.
- **Gate-A (operator)**: open a recorded hi-fi ISOLATED session, interact, close;
  `/admin/recordings` shows it; playback shows the real session video.

## Deployment (SEPARATE GATE — explicit user approval required)

Target **v0.64.0** (minor — new feature). Schema change (`RecordingFormat += VIDEO`)
→ bump **manager + migrate** together and run `access-migrate`; also **dataplane** +
**kasm-browser** image (ffmpeg + broker `/rec`). Update the gateway connector to pull
the new kasm image. Prod `RECORDING_ENABLED` stays as set. English `gh release edit`
note. No Claude signature.

## Global constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Transport B must not depend on `isolated.go` (A) — `kasmrecord.go` is self-contained;
  it may reuse the format-neutral helpers `newRecordingKey`/`recordingMaxBytes` from
  `guacrecord.go`, which are not A-specific.
- Video chunks stored unencrypted for this slice (at-rest encryption of video is a
  follow-up); on-prem DB, `recordSessions` opt-in, retention cron applies.
- Deploy requires explicit user approval; every tag gets an English user-focused
  `gh release edit` note.
- This is the last parity slice: after B3 ships and Gate-A passes, transport A is
  deleted (captivo-browser image + `isolated.go` + `isolationHiFi` toggle +
  descriptor VNC-isolated branch + form streaming-quality select → ISOLATED always
  KasmVNC).
