# Isolated Live Monitoring — Slice 2: Watch + Take-Control — Design

**Date:** 2026-08-14
**Status:** Approved (design)
**Part of:** Isolated live monitoring full-parity roadmap (Slice 1 = visibility + terminate, shipped v0.68.0).

## Goal

Let an admin watch an ISOLATED (KasmVNC) session live and take cooperative control of
it, reaching parity with GATEWAY sessions (which already have watch + take-control +
terminate). After this slice, all three access methods can be monitored and
intervened on live.

## Spike result (resolved)

The watch mechanism attaches a **second KasmVNC client to the same per-session Xvnc
display**. Xvnc's `DisconnectClients` default would drop the vendor if a new client
connected non-shared; the mitigation is to launch Xvnc with **`-AlwaysShared=1`**, so
every connection is treated as shared and the vendor is never dropped. The KasmVNC
web client already exposes a `view_only` setting (used for read-only vs control).
The core assumption is therefore de-risked to one Xvnc flag.

## Approach decision

Read-only enforcement is **client-side `view_only`** (option a): the admin's viewer
connects with `view_only=true` and sends no input; taking control reconnects with
`view_only=false`. The `controlOwner` gate coordinates one admin at a time + audit.
Xvnc accepts input from any client, so this is cooperative, not hard-enforced — the
admin (the trusted party) could bypass it. Server-side RFB input filtering (option b)
is a possible later hardening; out of scope here.

## Non-goals

- Server-side RFB input filtering / hard read-only enforcement.
- Isolated file transfer (separate roadmap item).
- Any change to GATEWAY watch/control or the vendor's isolated session path beyond the
  `-AlwaysShared` flag.

## Global constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not break the GATEWAY guac path, the transparent browserproxy, or the vendor's
  isolated connect/recording/terminate behaviour.
- `/kasm-view` must be routed in BOTH the prod host nginx and the shipped
  `deploy/Caddyfile` (see reference: front-proxy environments differ).
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

## Architecture

GATEWAY watch works by joining guacd's shared connection (`serveGuacView`, `select
connID`), read-only unless the viewer holds control; take-control flips input
forwarding, gated by `controlOwner`; terminate closes the tunnel. ISOLATED mirrors
this with VNC-native sharing instead of guacd join.

### Broker / Xvnc

**`kasm-browser/control.py` `_spawn(...)`:** add `-AlwaysShared=1` to the `Xvnc`
argument list (alongside the existing `-SendCutText`/`-AcceptCutText`). Guarantees a
second (admin) client shares the display rather than disconnecting the vendor.

### Data-plane

**`sessionhub.go` — store kasm attach info.** The isolated `liveSession` needs what a
viewer must dial: add `kasmAddr string` and `kasmPort int` fields (`connectorID` is
already stored). Extend `RegisterIsolated(sessionID, siteID, userID, host string,
startedAt time.Time, connectorID, kasmAddr string, kasmPort int)`. Add a
`kasmAttach() (connectorID, kasmAddr string, kasmPort int)` accessor (the VNC analog
of `shareInfo()`). `viewers`/`addViewer`/`removeViewer`/`controlOwner`/`SetControl`/
`ReleaseControl` are reused unchanged (they are kind-agnostic).

**`kasmtunnel.go` — pass attach info.** The `RegisterIsolated(...)` call in
`serveKasmTunnel` passes `d.KasmAddr` (the always-on hub host:port used for static
assets) and the per-session `port`.

**`kasmview.go` (new) — `serveKasmView(hub, ctrl, reg, w, r)`.** Mirrors
`serveKasmTunnel`'s reverse-proxy shape but attaches to an EXISTING session instead of
opening one:
1. Auth: `ca_session` cookie → `ctrl.ResolveSession` → `ctrl.ViewAuthz(viewerUserID)`
   (same gate as `serveGuacView`). 403 if not allowed.
2. Look up the session in the hub by `?session=<id>`; 404 if gone; read
   `kasmAttach()`.
3. `reg.Get(connectorID)` for the connector session; 502 if offline.
4. Reverse-proxy through the connector: non-WebSocket requests (the KasmVNC web
   client HTML/assets) → the hub addr (`kasmAddr`); WebSocket upgrades →
   `kasmSessionAddr(kasmAddr, kasmPort)` (the same per-session Xvnc the vendor is on).
   `addViewer()` on WS start, `removeViewer()` on end — so the "N watching" indicator
   works, matching gateway.
5. Path handling mirrors the tunnel: strip the `/kasm-view` prefix before proxying.

**`main.go` — routes.** Register `/kasm-view` and `/kasm-view/` →
`serveKasmView(hub, ctrl, reg, w, r)` on the public mux (next to `/kasm-tunnel` and
`/guac-view`).

**Take-control:** no data-plane change — the existing internal `/sessions/control`
(`hub.SetControl`/`ReleaseControl`) is kind-agnostic and already reached by
`/api/admin/live/[sessionId]/control`.

### Front proxy

Add a `/kasm-view` location to the prod host nginx config AND `deploy/Caddyfile`,
routing to the data-plane exactly like `/kasm-tunnel` and `/guac-tunnel` already do
(WebSocket-upgrade aware).

### Manager

**`/live/[sessionId]/page.tsx` — kind-aware viewer.** Resolve the session kind from
`listActiveSessions()` (find by `sessionId`). If `kind === "isolated"` render the new
`KasmLiveViewer`; otherwise render the existing guac `LiveViewer`. If the session is
not in the list (already ended), render `LiveViewer` (its error state shows "session
ended") — no special-casing needed. Keep the existing audit-log append and the
`canControl` gate.

**`KasmLiveViewer` (new client component).** Full-viewport iframe to
`/kasm-view/?session=<id>&path=kasm-view/websockify&view_only=<true|false>` (the
KasmVNC web client, second shared connection). Props `{ sessionId, canControl }`.
- Starts `view_only=true` (read-only).
- A "Take control" / "Release control" button (shown only when `canControl`): on take,
  `POST /api/admin/live/<id>/control {action:"take"}`; on success, reconnect the
  iframe with `view_only=false`. On release, POST `{action:"release"}` and reconnect
  with `view_only=true`. Reconnect = change the iframe `src` (React `key`/state) so
  the KasmVNC client reloads in the new mode.
- A "● LIVE / · CONTROLLING" badge, mirroring the guac `LiveViewer`.

**Console + admin table — restore Watch.** Re-add the "Watch live" link
(`/live/<sessionId>`) to the isolated console card (`security-console.tsx`) and a
"Watch" link to the isolated `/admin/live` table row (`live-table.tsx`) — the same
links the gateway card/row already have. Show the isolated card's viewer count
(`· N watching`) like the gateway card does.

## Data flow

1. Admin clicks "Watch live" on an isolated card/row → `/live/<sessionId>`.
2. Page resolves kind=isolated → `KasmLiveViewer` → iframe `/kasm-view?...view_only=true`.
3. `serveKasmView` authorizes, looks up the session's connector + kasm port, relays a
   second shared KasmVNC connection to the same Xvnc → admin sees the live screen,
   read-only; `addViewer` increments the count.
4. Admin clicks "Take control" → control endpoint sets `controlOwner` → iframe
   reconnects `view_only=false` → admin input reaches Xvnc (shared with the vendor).
5. Release / close → `ReleaseControl` + `removeViewer`; the vendor's session is
   unaffected throughout.

## Error handling

- Session ended before/while watching: hub lookup 404 → the viewer shows "session
  ended" (iframe fails to reach a live port; a 20 s connect timeout in the viewer
  reveals the error state rather than a permanent spinner).
- Connector offline: 502 from `serveKasmView`; viewer shows the error state.
- Control contention: `SetControl` returns `control already held` → the button shows
  the failure and stays in read-only (existing gateway behaviour).
- `-AlwaysShared` change is inert for single-client sessions (no behavioural change
  for vendors who are never watched).

## Testing

- `go build ./...` + `go test ./...` in `dataplane/` green (a hub unit test:
  `RegisterIsolated` stores kasm attach info and `kasmAttach()` returns it;
  `addViewer`/`removeViewer` reflected in `List()` viewerCount).
- `pnpm build` green.
- Manual Gate after deploy (the real validation of the spike):
  - Start an isolated session as a vendor; from the console, an admin clicks "Watch
    live" → sees the live screen read-only, vendor NOT disconnected, "1 watching"
    shown.
  - Admin "Take control" → can drive the isolated browser; vendor stays connected.
  - "Release control" → back to read-only. Close viewer → vendor session continues.
  - Terminate still ends the session; GATEWAY watch/control unchanged.

## Deploy

- Ships in `manager` + `dataplane` + `kasm-browser` images (the `-AlwaysShared` flag
  is in the kasm image → gateway host must pull the new kasm image / connector update
  for control to be drop-safe; watch of existing sessions works once dataplane +
  manager are up, but the drop-safety guarantee needs the new kasm image).
- Front proxy config change on the prod host (nginx) — applied out of band.
- No schema change → no migrate.
- Version bump + English `gh release edit` note. Deploy is a separate gate — do not
  auto-run.
