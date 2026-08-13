# RBI Transport B — Slice B1: KasmVNC High-Fidelity (Walking Skeleton) — Design

**Status:** Approved (brainstorm 2026-08-13/14). Transport B = **KasmVNC** (chosen over Neko/WebRTC after boot-checks: KasmVNC serves the web client + RFB-over-WebSocket on a **single port**, tunnels cleanly through the outbound-only connector like `/guac-tunnel`; no WebRTC/ICE/TURN/media-port). A (guacd/VNC) stays as the Standard transport / fallback; A may be retired later if B proves out.
**Backlog:** Pro layer, RBI. Transport B, slice B1 of B1/B2/B3 (B1 skeleton · B2 clipboard DLP + polish · B3 recording).
**Ships as:** v0.61.0 (schema + manager + dataplane + new browser image).

## Goal

Prove, end-to-end, that a vendor's real browser can view + control a KasmVNC-served
Chromium **through the connector's outbound-only tunnel**, for an ISOLATED resource
flagged **High-fidelity**. B1 is the walking skeleton: **single concurrent
hi-fi session** (a single-flight guard, exactly like A1), proving the transport +
render + feel. Concurrency, clipboard DLP, and recording are explicit non-goals.

Reuses A's product wiring: `accessMode=ISOLATED`, grant-check, launch flow, session
page, admin form, `ISOLATED_ENABLED` gate. B adds a per-site transport flag, a
KasmVNC browser image, a data-plane reverse-proxy tunnel, and the KasmVNC client.

## Why KasmVNC tunnels cleanly (boot-check confirmed)

KasmVNC's `Xvnc` runs with `-websocketPort <P> -httpd <www>` — it **is** the X
server + VNC + a built-in HTTP/WebSocket server on **one port** that serves both
the web client and the RFB-over-WS stream (adaptive webp/jpeg/video codecs → far
better feel than raw VNC). No guacd needed for this path. So the data-plane just
**HTTP+WS reverse-proxies one backend port** through the connector — simpler than
`/guac-tunnel` (no guac handshake).

## Components

### 1. Schema — `prisma/schema.prisma`

Add one additive field to `Site`:
```prisma
  isolationHiFi Boolean @default(false)  // ISOLATED transport: false = Standard (guacd/VNC), true = High-fidelity (KasmVNC)
```
Only meaningful when `accessMode = ISOLATED`. Additive (`db push`/migrate).

### 2. Browser image — `kasm-browser/` (new: `captivo-access-kasm-browser`)

A **lean** image we build (NOT the 4.63 GB `kasmweb/chromium`): Debian slim +
`kasmvncserver` + `chromium` + `fluxbox` + `python3`. Single-session for B1
(broker/concurrency is a follow-up, mirroring A1→A2). Entrypoint:
- `Xvnc :1 -geometry 1280x800 -websocketPort 6901 -httpd /usr/share/kasmvnc/www -SecurityTypes None -interface 0.0.0.0 …` — **no SSL** (internal-only, tunneled), **no VNC auth** (`SecurityTypes None`; the port is never public and access is grant-checked at the tunnel entry). Serves the client + WS on `6901`.
- `fluxbox` on `:1`; `chromium --kiosk --no-sandbox --disable-gpu --disable-dev-shm-usage --user-data-dir=/profile about:blank` on `DISPLAY=:1`.
- A tiny control server on `:7900` (reuse A1's `/navigate?url=` + `/reset` shape — relaunch Chromium at the URL). Same as A's control, different display server.

Published by `.github/workflows/publish.yml` (add `kasm-browser` to the matrix →
`ghcr.io/kurtserdar/captivo-access-kasm-browser`). Bundled on the gateway host next
to guacd + the A browser (connector `repair.ts`), on `captivo-gateway` as
`captivo-kasm` (ports 6901 + 7900 internal).

### 3. Data-plane — `/kasm-tunnel` reverse proxy (`dataplane/`)

New handler on the browser-facing mux (`:3103`, alongside `/guac-tunnel`):
`serveKasmTunnel`. It:
1. Authenticates `ca_session` → userID; `GatewayDescriptor` grant-check (reused); requires the descriptor's `kasm` transport marker + backend addr + navigateUrl.
2. Single-flight guard (`kasmSession`, same pattern as A1's `isoGuard` — one hi-fi session at a time in B1).
3. Navigate: dial the control port (`captivo-kasm:7900`) through the connector, `POST /reset` + `GET /navigate?url=<navigateUrl>` (reuse A's helpers).
4. **Reverse-proxy** the request to `http://captivo-kasm:6901` via a Go `httputil.ReverseProxy` whose `Transport.DialContext` opens a **connector yamux stream** (reuse `dialGuacd`'s relay) to that backend. `ReverseProxy` proxies both the KasmVNC client HTML **and** the WebSocket upgrade (Go's ReverseProxy handles `Upgrade`), so the whole KasmVNC experience rides one path through the connector.
5. On teardown: best-effort control `/reset`; release the guard.

nginx (front proxy) forwards `/kasm-tunnel` to the data-plane `:3103` with WS-upgrade
headers (same block shape as `/guac-tunnel`). Add the route to both the shipped
Caddyfile and the user's host-nginx.

### 4. Manager descriptor — `src/app/api/internal/gateway/descriptor/route.ts`

In the ISOLATED branch, if `site.isolationHiFi` (and `isolationEnabled()`), return a
**KasmVNC** descriptor instead of the VNC/guacd one:
```ts
{ transport: "kasm", navigateUrl: site.upstreamUrl ?? "",
  kasmAddr: process.env.ISOLATED_KASM_ADDR ?? "captivo-kasm:6901",
  kasmControlAddr: process.env.ISOLATED_KASM_CONTROL_ADDR ?? "captivo-kasm:7900",
  connectorId: site.connectorId, record: false /* hi-fi recording = B3 */ }
```
Standard (`isolationHiFi=false`) keeps the current guacd-VNC descriptor unchanged.
Add `isolationHiFi` to the `findUnique` select.

### 5. Launch + session page — `launch-href.ts`, `gateway/[siteId]/session/page.tsx`, session client

- `launchHref` unchanged (ISOLATED → `/gateway/[siteId]/session` regardless of transport).
- The session page selects the client by transport: for a hi-fi ISOLATED site it
  renders a **KasmVNC frame** (a full-viewport `<iframe src="/kasm-tunnel/">` — the
  reverse-proxied KasmVNC web client, which auto-connects its WS through the same
  proxied path) instead of the guacamole-common-js `GatewaySession`. The page reads
  `site.isolationHiFi` (add to its select) to branch. Standard ISOLATED + GATEWAY
  keep rendering `GatewaySession` (guac client) unchanged.

### 6. Site form — `src/app/(app)/admin/sites/site-form.tsx`

In the ISOLATED section, add a **Streaming quality** select (shown only when
`isolationEnabled`): *Standard (works everywhere)* vs *High-fidelity — KasmVNC
(beta)*. Bind to a new `isolationHiFi` boolean state; submit it; `validateSiteInput`
+ the create/update ISOLATED branches persist it. A hint notes hi-fi is smoother
but is not yet recorded (recording = a later release).

### 7. Gating

Reuse `ISOLATED_ENABLED` (the whole ISOLATED feature gate). The hi-fi option only
works if the `captivo-kasm` container runs on the gateway host (bundled by the
connector). No separate flag in B1.

## Non-goals (deferred)

- **Concurrency for hi-fi** → B-next (a KasmVNC broker mirroring A2; B1 is single-flight).
- **Clipboard DLP** for hi-fi (KasmVNC's native `-DLP_*` / cut-text flags) → **B2**.
- **Recording** hi-fi sessions (KasmVNC has no guac-stream to record; needs its own capture) → **B3**. In B1 a hi-fi descriptor returns `record: false` regardless of the site's toggle.
- Lean-image size optimization / unifying the A and B browser images → later.

## Testing

- **Unit (manager):** descriptor returns a `kasm` transport descriptor when
  `isolationHiFi` (mock); `validateSiteInput` persists `isolationHiFi` for ISOLATED;
  `launchHref` unchanged. `pnpm build`/`pnpm test` green.
- **Unit (dataplane, Go):** the connector-dialing `Transport.DialContext` builds the
  right relay target; single-flight `kasmSession` guard (2nd acquire fails, release
  re-allows). `go build`/`go test`.
- **Local spike (controller):** build `captivo-access-kasm-browser`; `docker run` it;
  confirm `Xvnc` listens on 6901 and serves the client (`curl` the httpd path → 200,
  no auth), control `/navigate` drives Chromium.
- **Gate A (operator, real browser — the decisive test):** an ISOLATED site set to
  **High-fidelity** → vendor Open → the KasmVNC client renders the internal app,
  **noticeably smoother than Standard** (scroll/video), input works. A Standard
  ISOLATED site + GATEWAY still work (regression). **Main risk to watch:** the
  reverse-proxied KasmVNC client's relative paths / WS upgrade through `/kasm-tunnel`
  — if the client fails to connect, it's a base-path/WS-proxy issue in `serveKasmTunnel`.

## Deploy

**v0.61.0** — schema (`isolationHiFi`) → **manager + migrate bump + `access-migrate run`**;
**dataplane bump** (`/kasm-tunnel`); publish the new **`captivo-access-kasm-browser`**
image; operator updates the gateway connector (pulls the kasm image, runs
`captivo-kasm`) and adds the `/kasm-tunnel` nginx route. Verify `/login` 200 +
`APP_VERSION`; then the local spike + Gate A; then an English `gh release edit` note
(Pro: high-fidelity isolated browser, beta, opt-in per resource).
