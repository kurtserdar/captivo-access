# Branded Connect Splash + Isolated-desktop background cleanup — Design

**Date:** 2026-08-14
**Status:** Approved (design)

## Goal

Give the vendor a branded, auto-dismissing "connecting…" screen at the start of
every remote session, covering the short wait until the remote desktop / isolated
browser is ready. Separately, stop the isolated-browser container from popping an
`fbsetbg` "I can't find an app to set the wallpaper with…" error box during that
same wait.

Reference UX (Kasm Workspaces' own loading splash): full-viewport overlay, centred
brand mark + resource name + "creating a secure connection…", disappears when the
session is ready. Ours uses the **console's own navy + verified-teal design
language**, not a stock photo background.

## Non-goals

- No change to the wallpaper *inside* the remote session. The RDP host's own
  desktop wallpaper (or its solid-black performance setting) is left exactly as it
  is. The isolated-browser desktop background becomes a plain solid colour only to
  kill the `fbsetbg` dialog — no brand image is painted onto it.
- Web App (TRANSPARENT) is out of scope for this slice. It is a redirect/proxy flow
  with its own web-session consent; a branded interstitial there is a separate slice.
- No new white-label / platform-logo configuration. The splash uses the existing
  product `BrandLockup` plus the per-resource `Site.name`.

## Global constraints

- English-only console strings, commits, and code comments. Proper Turkish only in
  chat.
- No Claude signature in commits or PRs.
- Do not break the native GATEWAY (RDP/SSH/VNC) guac path, the ISOLATED KasmVNC
  path, or the transparent browserproxy.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota is full — inline execution only.

## Architecture

Two independent pieces.

### Piece 1 — Isolated-desktop background cleanup (kasm image)

`fbsetbg` is fluxbox's wallpaper helper. On every isolated session `control.py`
launches `fluxbox`, which runs `fbsetbg`; with no wallpaper-setter installed it
raises an X dialog on the display, briefly visible in the VNC canvas before
Chromium `--kiosk` covers it.

Fix: install `hsetroot` in the image and paint a solid background right after
fluxbox starts, so `fbsetbg` finds a setter and no dialog appears.

- `kasm-browser/Dockerfile`: add `hsetroot` to the `apt-get install` list.
- `kasm-browser/control.py` `_spawn(...)`: after the `fluxbox` Popen, launch
  `hsetroot -solid "#000000"` on the same display (fire-and-forget, stdout/stderr
  to DEVNULL), before the Chromium Popen. Background stays plain black.

This is self-contained and ships in the dataplane/kasm image build. It does not
depend on Piece 2.

### Piece 2 — Branded connect splash (app-side, auto-dismissing)

A presentational `ConnectSplash` overlay, mounted above the session viewer and
unmounted by the parent when the session signals ready. Applies to GATEWAY and
ISOLATED, both of which render on the full-screen session route
`src/app/gateway/[siteId]/session/`.

**Ready signal (parent controls dismissal):**
- GATEWAY: guac `client.onstatechange` — dismiss when state === `3`
  (`Guacamole.Client.STATE_CONNECTED`). On `error`, the existing error screen
  replaces the splash.
- ISOLATED: the KasmVNC iframe's `onLoad`. To avoid a jarring flash on a very fast
  load, keep the splash for a minimum of 600 ms after mount before honouring the
  dismiss.
- Both: a 20 s max-timeout fallback force-dismisses the splash so a stuck connect is
  never hidden behind it (the real canvas / error shows through).

**Recording consent ordering (when required):** consent card first (existing
`ConsentGate` acknowledge flow) → then the session mounts with its splash → then the
session. When consent is not required: splash only, no click. Routing ISOLATED
through the consent path also closes the current gap where ISOLATED skips the
recording-consent gate entirely.

## Components & files

### `ConnectSplash` — new presentational component
`src/app/gateway/[siteId]/session/connect-splash.tsx` (client component).

- Props: `{ siteName: string }`.
- Renders a `position: fixed; inset: 0` overlay above the viewer: `BrandLockup`,
  the `siteName`, the copy "Creating a secure connection…", and an animated
  ring/spinner. Navy background, verified-teal accent ring, using the existing
  globals.css design tokens (`--bg`, `--accent`, etc.) — no photo background.
- Always visible while mounted; it holds no dismiss logic. The parent decides
  when to stop rendering it.
- Respects `prefers-reduced-motion` (ring pulse/spin disabled, static ring shown).

### `GatewaySession` — add ready state + splash
`src/app/gateway/[siteId]/session/session-client.tsx`.

- Add prop `siteName: string`.
- Add `const [ready, setReady] = useState(false)`.
- In the guac setup (around line 130), set
  `client.onstatechange = (state: number) => { if (state === 3 && !disposed) setReady(true); };`
  (STATE_CONNECTED). Keep existing `onerror`/`tunnel.onerror` → `setError`.
- Add a 20 s max-timeout in the connect effect that calls `setReady(true)` as a
  fallback; clear it on cleanup and on error.
- Render `{!ready && !error && <ConnectSplash siteName={siteName} />}` alongside the
  existing display/error markup. The error screen already replaces content on
  failure; when `error` is set the splash is not rendered.

### `IsolatedSession` — new client wrapper for the kasm iframe
`src/app/gateway/[siteId]/session/isolated-client.tsx` (client component).

- Props: `{ siteId: string; siteName: string }`.
- Renders the existing full-viewport KasmVNC iframe (moved verbatim from
  `page.tsx`, same `kasmParams`, same `src`, same `allow`) plus
  `{!ready && <ConnectSplash siteName={siteName} />}`.
- `ready` state driven by iframe `onLoad` (honoured only after a 600 ms minimum) and
  the 20 s max-timeout fallback.
- Reason for extracting: the iframe currently lives in the server component; the
  splash + dismiss logic needs client state.

### `ConsentGate` — make it mode-aware
`src/app/gateway/[siteId]/session/consent-gate.tsx`.

- Add props `accessMode: "GATEWAY" | "ISOLATED"` and `siteName: string`.
- After `accepted`, render the correct viewer:
  `accessMode === "ISOLATED" ? <IsolatedSession siteId={siteId} siteName={siteName} />
  : <GatewaySession siteId={siteId} siteName={siteName} recorded={recorded} clipboardMode={clipboardMode} />`.
- Keep the existing acknowledge card copy and the `POST /api/gateway/:id/consent`
  call unchanged.

### `page.tsx` — route both modes through consent, pass name
`src/app/gateway/[siteId]/session/page.tsx`.

- Add `name: true` to the `db.site.findUnique` select.
- Remove the early ISOLATED `return <iframe .../>`. Compute `recorded` and
  `consentNeeded` (as today) for both modes, then route:
  - `consentNeeded` → `<ConsentGate accessMode={site.accessMode} siteId={siteId}
    siteName={site.name} recorded={recorded} clipboardMode={site.clipboardMode} />`
  - else if ISOLATED → `<IsolatedSession siteId={siteId} siteName={site.name} />`
  - else → `<GatewaySession siteId={siteId} siteName={site.name} recorded={recorded}
    clipboardMode={site.clipboardMode} />`
- Keep the capability guards (`okGateway` / `okIsolated`, `notFound()`) and the
  `recorded = recordingEnabled() && site.recordSessions` logic. For ISOLATED,
  `recorded` follows the same rule (isolated recording is B3), so the consent gate
  now also fires for recorded isolated sessions.

### CSS
`src/app/globals.css`: add `.connect-splash` (overlay, centred column, backdrop),
`.connect-splash-ring` (teal accent ring + spin/pulse), and the reduced-motion
override. Reuse existing tokens; no new colours introduced beyond the token set.

## Data flow

1. Vendor opens `/gateway/<siteId>/session`.
2. Server component loads the site (accessMode, name, recordSessions,
   clipboardMode), resolves recording/consent.
3. Consent required → consent card → on accept, viewer mounts.
4. Viewer mounts with `ConnectSplash` visible.
5. GATEWAY: guac reaches STATE_CONNECTED → splash unmounts. ISOLATED: iframe onLoad
   (≥600 ms) → splash unmounts. Either: 20 s fallback → splash unmounts.
6. On guac error, error screen shows instead of the splash.

## Error handling

- Guac/tunnel error → existing `setError` path; splash suppressed (not shown over an
  error).
- Connect hangs → 20 s fallback dismisses the splash; the vendor sees the real
  canvas state (KasmVNC "Connecting…" or the guac error), never a permanently stuck
  brand screen.
- `hsetroot` failure in the container is non-fatal (fire-and-forget); worst case the
  old plain background remains — no session impact.

## Testing

Consistent with prior UI slices (no React Testing Library in this repo):

- `pnpm build` green (typecheck for the new props/threading through page → consent
  → session components).
- `go build ./...` unaffected (no dataplane code change in Piece 2).
- Manual Gate after deploy:
  - ISOLATED: connect to an isolated site; branded splash shows then disappears when
    the browser loads; no `fbsetbg` dialog visible in the canvas.
  - GATEWAY (RDP): connect; branded splash shows until the desktop appears, then
    disappears.
  - Recorded resource with consent required: consent card → splash → session, for
    both GATEWAY and ISOLATED.
  - Guac failure path still shows the error screen (splash not stuck).

## Deploy

- Piece 1 ships in the kasm/dataplane image build; operators pull the new image (and
  the running isolated-browser is replaced on next session spawn / image update).
- Piece 2 ships in the manager image.
- Version bump + English `gh release edit` note. Deploy is a separate gate — do not
  auto-run.
