# Client-sized Isolated Desktop — Design

**Date:** 2026-08-14
**Status:** Approved (design)

## Goal

Make an isolated browser session fill the vendor's screen exactly in browser
fullscreen — no aspect-ratio letterbox — while keeping recordings correct. Instead of
a fixed 1280×800 desktop scaled to fit (which letterboxes on any non-16:10 screen, e.g.
recent ~1.54:1 MacBooks), start the isolated desktop at the vendor's own screen size,
fixed for the session, so the recorder captures it fully.

## Why not resize=remote

`resize=remote` matches the desktop to the viewport dynamically, but the recorder's
x11grab captures a fixed region set at ffmpeg start — a mid-session resize leaves the
recording mis-framed (the "top-left quarter" regression in v0.70.2). Sizing the desktop
to the client's screen once, up front, and keeping it fixed gives exact fullscreen fill
AND a recording that is always correct (never resizes). The trade-off: if the vendor
resizes their window (before entering fullscreen) they may see a small letterbox until
fullscreen; a mid-session monitor move keeps the original size (rare).

## Approach

The client measures its screen size and passes it when opening the session; the broker
starts Xvnc and the recorder at that size (clamped); the KasmVNC client stays on
`resize=scale`. Desktop size is fixed per session.

- **Fullscreen (green button / Fullscreen API):** iframe viewport ≈ screen = desktop →
  1:1, exact fill (the desktop is already the screen's aspect, so no letterbox).
- **Recording:** captured at the fixed desktop size → always correct + crisper (native
  screen resolution instead of upscaled 1280×800).
- **Windowed (before fullscreen):** the screen-sized desktop scales into the smaller
  window (mild letterbox if the window aspect differs) — acceptable; fullscreen is the
  "fill" target.

## Non-goals

- No dynamic resize following (no resize=remote). A window resize / monitor move
  mid-session does not re-size the desktop.
- Existing recordings are unaffected.
- Admin live viewer (`KasmLiveViewer`) is unchanged — it stays `resize=scale`, fitting
  whatever size the vendor's desktop is into the admin window.

## Global constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Backward compatible: a session opened without a size falls back to 1280×800 (today's
  behaviour), so nothing breaks if the size doesn't arrive.
- Clamp the size to sane bounds (min 1024×640, max 2560×1600) to bound resources and
  reject bad input.
- Do not break live watching, terminate, recording finalize/seek, or GATEWAY.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

## Architecture

Size flows: client iframe URL → cookie (for the query-less WebSocket upgrade) →
`serveKasmTunnel` → `openKasmSession` → broker `POST /session` → Xvnc/ffmpeg geometry.
This mirrors how `site` already flows via the `ca_kasm_site` cookie.

### Manager (`isolated-client.tsx`)

- On mount (client component), measure `window.screen.width` × `window.screen.height`
  (CSS px — logical, matching the guac session's 96-DPI choice; avoids doubling
  resources on Retina), round, and clamp to [1024..2560] × [640..1600].
- Render the iframe only once the size is known (the `ConnectSplash` already covers the
  pre-connect moment), with `&w=<w>&h=<h>` added to the `/kasm-tunnel/` URL. Keep
  `resize=scale`.
- Rationale for `screen` (not `innerWidth`): in browser fullscreen the viewport ≈ the
  screen, so a screen-sized desktop fills fullscreen exactly.

### Data-plane (`kasmtunnel.go`)

- `serveKasmTunnel`: read `w`/`h` from the query; when present, set a `ca_kasm_size`
  cookie (`"<w>x<h>"`, Path `/kasm-tunnel`) so the query-less websockify upgrade
  inherits them (same pattern as `ca_kasm_site`). On the WS upgrade, read `w`/`h` from
  the query or the cookie, parse+clamp (fallback 1280×800), and pass to
  `openKasmSession`.
- `openKasmSession(rw, host, target, copyOut, pasteIn, w, h)`: include `"w"` and `"h"`
  in the `POST /session` JSON body.

### Broker (`kasm-browser/control.py`)

- `POST /session`: read `w`/`h` from the JSON body, clamp (min 1024×640, max
  2560×1600, default 1280×800 on missing/invalid).
- `open_session(url, copy_out, paste_in, w, h)` → `_spawn(..., w, h)`:
  - `Xvnc … -geometry {w}x{h}` (instead of the hardcoded 1280×800).
  - `_ffmpeg_capture(display, recfile, w, h)` → `-video_size {w}x{h}`.
- Keep the `-b:v 1M` bitrate (browser content is largely static; adequate at these
  sizes). All other Xvnc/ffmpeg flags (tee, AlwaysShared, SendCutText, etc.) unchanged.

## Data flow

1. Vendor opens the isolated session → client measures screen size → iframe loads
   `/kasm-tunnel/?site=…&w=1470&h=956&resize=scale&…`.
2. `serveKasmTunnel` sets `ca_kasm_size=1470x956`; the KasmVNC client's websockify WS
   upgrade (no query) reads it → `openKasmSession(… w=1470 h=956)` → broker starts a
   1470×956 desktop + recorder.
3. Vendor presses the green button → browser fullscreen → viewport ≈ 1470×956 = desktop
   → exact fill.
4. Session ends cleanly → the 1470×956 recording is finalized/seekable and plays at its
   native size.

## Error handling

- Missing/invalid `w`/`h` (old client, tampered value) → broker clamps to defaults
  (1280×800) → session still works, today's behaviour.
- Out-of-range values → clamped into [1024..2560] × [640..1600].
- Cookie not yet set when the WS upgrade arrives (shouldn't happen — the HTML request
  precedes the WS) → falls back to default size.

## Testing

- Broker: `python3 -c "import ast; ast.parse(...)"` + a container spike confirming Xvnc
  `-geometry 1470x956` + ffmpeg `-video_size 1470x956` start and produce a correct-size
  recording (standard flags; low risk).
- Data-plane: `go build ./...` + `go test ./...` green.
- Manager: `pnpm build` green.
- Manual Gate after deploy: connect from a MacBook, press the green button → the
  isolated browser fills the screen with no letterbox; end cleanly → the recording is
  full-screen (not a quarter) and plays with correct duration/seek. An external monitor
  still fills. Live watching + GATEWAY unchanged.

## Deploy

- Ships in `kasm-browser` + `dataplane` + `manager` images (gateway host pulls the new
  kasm image for the geometry change).
- No schema change → no migrate.
- Version bump + English `gh release edit` note. Deploy is a separate gate — do not
  auto-run.
