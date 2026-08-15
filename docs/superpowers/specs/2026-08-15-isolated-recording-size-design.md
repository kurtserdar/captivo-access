# Isolated Recording Size Reduction — Design

**Date:** 2026-08-15
**Status:** Approved (design)
**Scope:** ISOLATED (KasmVNC) session video recordings only

## Problem

Isolated-browser sessions record to WebM video (VP8), captured by ffmpeg
(`x11grab`) in the broker on the connector's gateway host. The current encode
is `libvpx (VP8) -b:v 1M -framerate 10` at the vendor's screen resolution (up
to 2560×1600). At ~1 Mbit/s that is roughly **450 MB per session-hour**,
stored chunked in Postgres (`SessionRecording` / `RecordingChunk`, format
`VIDEO`). Recordings are the dominant disk cost.

Text recordings (web `RRWEB`, gateway `GUAC`) are already gzip-compressed at
rest — no further win there. VP8 WebM is already codec-compressed, so gzip on
it saves ~0%. The only lever for video is the **encode** itself.

## Key facts that shape the design

- **Size ≈ bitrate × duration**, largely independent of resolution. So the
  direct size lever is **bitrate**; resolution sets *quality-per-bit* at that
  bitrate. Capping resolution lets a lower bitrate stay readable — that is why
  the two changes pair.
- **The recording is decoupled from what anyone watches live.** The vendor
  sees a full-resolution pixel stream; an admin's live view is a *separate*
  KasmVNC client via `/kasm-view`. Downscaling the recording affects **only the
  stored replay** — not the vendor's view, not the live admin view.
- **Encode runs on the customer's gateway host**, not the cloud, and up to
  `MAX_SESSIONS` (default 5) isolated sessions can encode concurrently on it.
  This rules out realtime VP9 as a default (CPU risk on modest/shared boxes).
  Smaller frames from the cap also *reduce* encode CPU.

## Approach: resolution cap + tuned VP8 bitrate

Change only `_ffmpeg_capture` in `kasm-browser/control.py`. Keep VP8, the
10 fps rate, the `tee` muxer (live pipe + seekable file), realtime deadline,
and the seekable-finalize behavior. Two edits:

1. **Cap the recording resolution, aspect-preserving, never upscaling:**
   ```
   -vf scale='min(<MAXW>,iw)':-2
   ```
   Scales width down to `MAXW` only when the native desktop is wider; height
   follows the aspect ratio (`-2` = auto, even). Width-cap (not fixed WxH)
   because isolated desktops take the vendor's screen aspect (MacBook ~1.54:1,
   16:10, 16:9) and a fixed WxH would distort them.

2. **Lower the target bitrate** from `1M` to `<BITRATE>` (default `512k`).

Both are read from env with safe defaults so they can be tuned without
rebuilding the connector image:

| Env | Default | Meaning |
|---|---|---|
| `RECORDING_MAX_WIDTH` | `1280` | Max recording width in px; native width used if smaller. |
| `RECORDING_VIDEO_BITRATE` | `512k` | ffmpeg `-b:v` target for the recording. |

`RECORDING_MAX_WIDTH` must parse as a positive integer; on a non-integer or
`<= 0` value, fall back to the default `1280`. `RECORDING_VIDEO_BITRATE` is
passed to ffmpeg verbatim (it accepts forms like `512k`, `700k`, `1M`); an
empty/whitespace value falls back to `512k`.

### Resulting ffmpeg command (shape)

```
ffmpeg -loglevel error -f x11grab -video_size <w>x<h> -framerate 10 -i :<display>
       -an -vf scale='min(1280,iw)':-2 -c:v libvpx -b:v 512k -deadline realtime
       -f tee -map 0:v "[f=webm:onfail=ignore]pipe:1|[f=webm]<recfile>"
```

The `-vf` simple filtergraph applies before the `tee`, so **both** sinks (live
interim pipe + seekable file) carry the capped, lower-bitrate stream. `-map 0:v`
continues to map the (now filtered) video. No change to how the data-plane
streams the interim pipe or pulls the finalized file.

## Expected outcome

- ~450 MB/session-hour → ~**230 MB** (~50%), more on static-heavy sessions
  (VBR undershoots on unchanging screens).
- Encode CPU **decreases** (smaller frames; the downscale cost is less than the
  saving from encoding fewer pixels).
- Text remains readable at 1280-wide / 512k for typical web-app content; if a
  deployment finds it soft, bump `RECORDING_VIDEO_BITRATE` (e.g. `768k`) or
  `RECORDING_MAX_WIDTH` via env — no rebuild.

## Non-goals

- **No VP9.** Realtime VP9 on a shared customer gateway box is a CPU risk;
  parked as a possible later opt-in (would require a documented connector
  min-spec). Not in this slice.
- No change to `RRWEB`/`GUAC` recordings (already gzip-compressed).
- No change to the storage schema, the recording player, the live-view path,
  retention, or the finalize/seekable pipeline.
- No re-encoding of existing recordings — the change is forward-only; old
  recordings stay as they are and still play.

## Compatibility

New recordings are still VP8 WebM, just smaller and (when the desktop is wider
than the cap) downscaled. The `/admin/recordings` player already handles WebM;
the `format` enum stays `VIDEO`. Nothing to migrate.

## Testing

- **Unit (broker):** a small test that builds the ffmpeg arg list and asserts
  the `-vf scale='min(1280,iw)':-2` filter and `-b:v 512k` are present with the
  defaults, and that `RECORDING_MAX_WIDTH` / `RECORDING_VIDEO_BITRATE` env
  overrides flow through (including the integer/empty fallbacks). This requires
  extracting the arg list into a testable pure function (e.g.
  `_ffmpeg_args(display, recfile, w, h)`), with `_ffmpeg_capture` calling it —
  mirrors the existing `_safe_name` extraction pattern.
- **Byte-compile** `control.py` + run the broker test.
- **Manual (post-deploy, needs connector update):** record the same session
  before/after; compare stored size and confirm the replay text is readable and
  seeking still works; confirm the vendor's live view and the admin `/kasm-view`
  live view are unaffected (full resolution).

## Release

Deploy + release notes are separate standing gates — do NOT auto-run. The
change ships in the `kasm-browser` image, which runs **connector-side**, so it
only takes effect once the connector/gateway host is updated (same as prior
isolated broker changes). On tag, add an English user-focused `gh release edit`
note.
