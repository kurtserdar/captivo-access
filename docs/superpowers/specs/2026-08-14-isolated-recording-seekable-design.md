# Seekable Isolated Recordings (hybrid) — Design

**Date:** 2026-08-14
**Status:** Approved (design)

## Goal

Make ISOLATED (KasmVNC) session recordings seekable in the admin player — a correct
duration and the ability to scrub to any second — while keeping the crash-safety of
today's live streaming (a session that dies mid-way still leaves a partial recording).

## Problem

Isolated recording runs `ffmpeg … -f webm -` writing to a **pipe** (stdout). A
non-seekable output cannot get a `Duration` in SegmentInfo or a `Cues` (seek index),
so the browser sees an unknown/`Infinity` duration and cannot seek — the scrubber
sits at the end. The serving route also returns the whole blob with `200` and no
`Range` support, which independently breaks `<video>` seeking. GATEWAY recordings are
a different (guac) format and are unaffected.

ffmpeg only writes `Duration`+`Cues` when the output is **seekable** (a file it can
rewind on clean exit). So the fix requires recording to a file, finalized cleanly.

## Approach: hybrid (live chunks + finalized file)

Keep the live stream (crash safety) AND produce a seekable file, one encode:

- The broker runs a single ffmpeg with the **`tee` muxer** writing two sinks: the
  live **pipe** (today's `/rec` stream → crash-safe interim chunks) and a **seekable
  file** on disk. If the pipe sink fails (viewer/manager gone), `onfail=ignore` keeps
  the file writing.
- On a clean session end the file is finalized (ffmpeg **SIGINT**, not SIGKILL, so it
  writes the trailer + Cues + Duration) and pulled to the manager, **replacing** that
  recording's interim chunks with the seekable version.
- On a crash (connector/container dies mid-session) the finalize never runs and the
  recording keeps its live interim chunks — exactly today's behaviour, no data loss.

Result: clean session → fully seekable recording; crash → partial recording as today.
Existing recordings stay non-seekable (their source is gone; not retrofittable).

## Non-goals

- No change to GATEWAY (guac) recording or live watching (`/kasm-view`).
- No retrofit of already-stored recordings.
- No at-rest encryption change (VIDEO stays `encrypted:false` as today).

## Global constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not break live watching, terminate, the vendor session, or GATEWAY recording.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

## Architecture

### Broker (`kasm-browser/control.py`)

- **Recording start (on `/rec`):** replace the single-output `_ffmpeg_capture` with a
  `tee` command writing both `pipe:1` (streamed in the `/rec` response, as today) and
  a per-session file `/rec/<sid>.webm`. Store the ffmpeg process handle + file path on
  the session dict (`_sessions[sid]["rec_proc"]`, `["rec_file"]`).
- **Finalize on `/rec` disconnect:** when the `/rec` client disconnects (WS end), send
  the ffmpeg process **SIGINT** and wait for exit (clean finalize) instead of
  terminate/kill, leaving a seekable `/rec/<sid>.webm`.
- **New `GET /session/<sid>/recording`:** stream the finalized `/rec/<sid>.webm` if it
  exists (404 otherwise). Read-and-forward; do not delete here.
- **`POST /session/<sid>/close`:** additionally remove `/rec/<sid>.webm` during
  cleanup (kill any lingering ffmpeg first).
- Size cap: bound the file with ffmpeg `-fs <capBytes>` (or the reaper) so a runaway
  session can't fill the disk — mirrors today's `recordingMaxBytes` intent.

### Data-plane (`kasmtunnel.go`, `kasmrecord.go`)

- **During the session:** unchanged — `kasmRecWriter` streams live `/rec` bytes to
  `ingest-video` (interim, crash-safe recording under `recordingKey`).
- **On clean WS end:** after the live `/rec` relay closes (broker finalizes the file),
  and BEFORE the broker `close`, pull the finalized file: `GET
  /session/<sid>/recording` through the connector → stream its bytes to a new manager
  endpoint `finalize-video` (same `recordingKey`, chunked like `ingest-video`). Then
  the existing broker `close` runs (removing the file). Best-effort: any failure
  leaves the interim chunks intact.
- This changes the WS-end teardown from pure `defer`s to an explicit ordered sequence
  (stop live relay → finalize-pull → broker close), so the finalize happens while the
  connector tunnel + broker session are still alive.

### Manager

- **New `POST /api/internal/recording/finalize-video`:** dataplane-authenticated;
  accepts `{ recordingKey, seq, data }` chunks of the seekable file. On the first
  finalize chunk (`seq === 0`) it **deletes the recording's existing
  `RecordingChunk` rows**, then appends the finalize chunks in order, updating
  `bytes`. Format stays `VIDEO`. No schema change (chunk replacement is sufficient;
  seekability is implicit once the bytes are the finalized file). Late interim chunks
  cannot arrive (the live relay has ended before finalize), so no race.
- **`GET /api/admin/recordings/[id]/video` — add HTTP Range:** honour the `Range`
  request header, returning `206 Partial Content` with `Content-Range` +
  `Accept-Ranges: bytes` for the requested slice (and `200` + `Accept-Ranges: bytes`
  when no range). The blob is assembled from chunks as today, then sliced. Enables
  smooth scrubbing on the seekable file.
- **Player:** no change — `<video controls src=…>` seeks once the served bytes are a
  seekable WebM and the route supports Range.

## Data flow

1. Vendor session records: broker ffmpeg tees pipe + file; dataplane streams the pipe
   to `ingest-video` (interim recording K).
2. Clean end: `/rec` closes → broker SIGINTs ffmpeg → `/rec/<sid>.webm` finalized.
3. Dataplane pulls `/session/<sid>/recording` → `finalize-video` replaces K's chunks
   with the seekable file → broker `close` removes the file.
4. Admin opens the recording → the route serves the seekable WebM with Range → the
   player shows the real duration and scrubs correctly.
5. Crash before step 2: K keeps its interim chunks (partial, non-seekable) — no loss.

## Error handling

- Finalize pull fails (connector blip at close): interim chunks remain; the recording
  is still playable (non-seekable), never empty.
- Broker file missing on `/session/<sid>/recording` (recording disabled / ffmpeg
  never ran): 404 → dataplane skips finalize, interim chunks stand.
- `tee` pipe backpressure / manager gone mid-session: `onfail=ignore` keeps the file;
  the live relay just stops.

## Spike (validate in the plan)

The `tee` muxer with x11grab + two WebM sinks (pipe + file), pipe `onfail=ignore`, and
SIGINT-finalize producing a seekable file — validate the exact ffmpeg invocation in a
throwaway container run before wiring the full flow. Known-good fallback if `tee`
misbehaves: two separate ffmpeg outputs from one input (`… -f webm pipe:1 -f webm
/rec/<sid>.webm`), which most ffmpeg builds accept.

## Testing

- Broker: `python3 -c "import ast; ast.parse(...)"` + a manual container run of the
  tee ffmpeg command producing a seekable file (spike).
- Data-plane: `go build ./...` + `go test ./...` green.
- Manager: `pnpm build` green.
- Manual Gate after deploy: record an isolated session, end it cleanly, open the
  recording — the duration is correct and scrubbing to any second works. Kill a
  session mid-way — a partial recording still exists and plays. GATEWAY recordings
  and live watching unchanged.

## Deploy

- Ships in `kasm-browser` + `dataplane` + `manager` images (gateway host pulls the new
  kasm image for the tee/finalize; the finalized-file flow needs all three).
- No schema change → no migrate.
- Version bump + English `gh release edit` note. Deploy is a separate gate — do not
  auto-run.
