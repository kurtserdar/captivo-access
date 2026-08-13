# RBI Transport B (KasmVNC) — Concurrency Broker Design

**Date:** 2026-08-14
**Status:** Approved (brainstorm)
**Slice:** RBI B-concurrency (the A2 equivalent for the high-fidelity isolated browser)

## Goal

Lift the high-fidelity (KasmVNC) isolated browser from **one session at a time**
to **N concurrent sessions**, mirroring the proven transport-A concurrency broker
(A2). Each vendor viewing an `ISOLATED` + high-fidelity site gets its own fresh
Chromium + profile on its own KasmVNC display, isolated from every other session.

This slice is **concurrency only**. Clipboard data-leak control (B2) and
high-fidelity session recording (B3) are explicitly out of scope and remain the
next parity slices before transport A can be retired.

## Background

Today (B1, v0.61.2) the data-plane serialises hi-fi isolated sessions with a
single-flight lock (`kasmSession isoGuard` in `dataplane/kasmtunnel.go`): the
second concurrent WebSocket upgrade gets `503 "isolated browser at capacity"`.
The `captivo-kasm` container runs exactly one `Xvnc :1` on port 6901 that serves
both the KasmVNC web client (static HTML/assets) and the live RFB-over-WebSocket,
and one `control.py` that relaunches a single Chromium via `/navigate`.

Transport A already solved concurrency (A2, `browser/control.py` +
`dataplane/isolated.go`): an in-container broker spawns a per-session process
group (no docker socket — sessions are processes inside one container) on demand
and reaps it on close, with `MAX_SESSIONS` default 5 and a TTL reaper. This slice
reuses that pattern for KasmVNC.

## The KasmVNC-specific problem and the chosen approach

In transport A only the RFB **protocol** flows through the tunnel; the web client
(`guacamole-common-js`) is served by the manager. So "session = one WebSocket" and
the broker is opened on the WS upgrade and closed when the WS ends — clean.

KasmVNC is different: the `captivo-kasm` container serves **both** the web client
(HTML + dozens of assets) **and** the live RFB-WS from the same port. Under
concurrency each session is a separate `Xvnc` on a separate port, so every one of a
vendor's requests (HTML, assets, WS) must reach the *same* session's port.

**Chosen approach — Hub + per-session split (Approach A):**

- A static **hub**: one always-on `Xvnc :1` on the fixed port 6901 serves the
  KasmVNC web client (HTML + assets). These bytes are identical for every session
  and need no live display.
- The broker spawns a **per-session** `Xvnc :N` on port `6900+N` plus Chromium
  opened directly at the target URL. Only the live **RFB-WS** comes from this port.
- The data-plane routes: non-WebSocket requests → hub (6901, static); WebSocket
  upgrade → broker-allocated per-session port.
- **Session lifecycle == WebSocket lifecycle** (transport-A parity): the session is
  created on the WS upgrade and closed when the WS ends. No cookie-based session
  pinning, so no reload/tab-close races.

Rejected alternative (Approach B — cookie-pin the whole view): allocate on the HTML
load and pin assets+WS with a `ca_kasm_sess` cookie. Rejected for reload races
(pinning to a torn-down port), orphan sessions when the WS never opens, and more
complex routing.

Cost of the chosen approach: one idle `Xvnc :1` (~30 MB) serving static files. The
per-session `Xvnc` also serves its own www, but the data-plane never routes there.

## Components

### 1. `captivo-kasm` image (`kasm-browser/`)

**`entrypoint.sh`** — start the static hub, then the broker:

```sh
#!/bin/sh
set -e
mkdir -p /root/.vnc
cp /kasmvnc.yaml /root/.vnc/kasmvnc.yaml
# Hub: serves the static KasmVNC web client on the fixed port 6901. Its display is
# never rendered to (no window manager, no browser) — only per-session Xvnc
# instances carry live displays. The data-plane routes only the web client
# (HTML/assets) here; the live RFB-WS goes to per-session ports.
Xvnc :1 -geometry 1280x800 -depth 24 -websocketPort 6901 -interface 0.0.0.0 \
  -httpd /usr/share/kasmvnc/www -SecurityTypes None -disableBasicAuth &
sleep 2
exec python3 /control.py
```

(Drop the hub's `fluxbox` — the hub never renders a window; per-session `fluxbox`
is spawned by the broker.)

**`control.py`** — rewrite as the broker, mirroring `browser/control.py` (A2). The
only structural difference from A2 is that each session is a single `Xvnc`
(display + RFB + WS on one port) instead of `Xvfb` + `x11vnc`, and the returned
field is `port` (the KasmVNC websocket/http port) rather than `vncPort`.

Broker contract (HTTP on `0.0.0.0:7900`):

- `POST /session` body `{"url": "<http(s) url>"}` →
  - reject non-`http(s)` url → `400 {"error":"bad_url"}`
  - if `len(sessions) >= MAX_SESSIONS` → `503 {"error":"capacity"}`
  - else allocate the lowest free display `N` in `2..MAX_SESSIONS+1`, **clear the
    stale X lock + socket** (`/tmp/.X{N}-lock`, `/tmp/.X11-unix/X{N}`) before
    starting, spawn the per-session group, return `201 {"id": "<sid>", "port": 6900+N}`
- `POST /session/<id>/close` → SIGTERM→SIGKILL the group, `rmtree` the profile,
  free the slot → `200 {"ok": true}`
- `GET /healthz` → `200 {"ok": true}`
- TTL reaper: every 60 s, reap sessions older than `MAX_SESSION_SECONDS`
  (default 14400 = 4 h) — leak protection if the data-plane dies mid-session.

Per-session spawn (`_spawn`), for display `N`, port `6900+N`, profile
`/profiles/<sid>`:

```python
Xvnc :N -geometry 1280x800 -depth 24 -websocketPort <6900+N> -interface 0.0.0.0 \
  -httpd /usr/share/kasmvnc/www -SecurityTypes None -disableBasicAuth
fluxbox                       # DISPLAY=:N
chromium --kiosk --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --no-first-run --no-default-browser-check --disable-translate \
  --user-data-dir=/profiles/<sid> <url>     # DISPLAY=:N
```

Config knobs (env, same names/defaults as A2): `MAX_SESSIONS` (default 5),
`MAX_SESSION_SECONDS` (default 14400).

**Traps baked in from the start (learned in A-series Gate-A):**
- Chromium as root needs `--no-sandbox` (already present).
- A SIGKILLed `Xvnc` on a reused display leaves a stale `/tmp/.X{N}-lock` + socket,
  so the next `Xvnc :N` refuses to start and serves a dead/blank display. The
  broker removes both before every spawn (same fix as A2's `_spawn`).

### 2. Data-plane (`dataplane/kasmtunnel.go`)

- **Remove** the `kasmSession isoGuard` single-flight, `type isoGuard`,
  `buildNavigateRequest`, `buildResetRequest` (navigation now happens by the broker
  spawning Chromium directly at the target URL — no separate navigate/reset step).
- **Add a self-contained broker client in `kasmtunnel.go`** — `openKasmSession` and
  `buildKasmCloseRequest`, mirroring `isolated.go` but **independent of it**.
  Rationale: transport A (`isolated.go`) is deleted after B3, so transport B must
  not depend on A's file.
- **`serveKasmTunnel`** after the existing session resolve + descriptor +
  `ca_kasm_site` pin:
  - **Not a WebSocket upgrade** (web client HTML/assets): reverse-proxy to the hub
    `d.KasmAddr` (e.g. `captivo-kasm:6901`) — unchanged from B1.
  - **WebSocket upgrade**: dial the broker (`d.KasmControlAddr`) through the
    connector (`dialGuacd`), `POST /session {navigateUrl}`; on `503` → respond
    `503 "isolated browser at capacity"`; on other error → `502`. On success,
    reverse-proxy the WebSocket to the per-session backend `hostOf(d.KasmAddr):port`
    (a helper keeps the hub host, swaps in the per-session port for the
    `Transport.DialContext` target). When the reverse-proxy returns (WS closed),
    dial the broker again and `POST /session/<id>/close`.
- **Helper** `kasmSessionAddr(kasmAddr string, port int) string`: replace the port
  in `host:port` with the per-session port (hub host preserved).

### 3. Unchanged

- **Descriptor** (`src/app/api/internal/gateway/descriptor/route.ts`): still returns
  `transport:"kasm"`, `kasmAddr` (hub `captivo-kasm:6901`), `kasmControlAddr`
  (broker `captivo-kasm:7900`), `navigateUrl`, `record:false`. No new fields — the
  per-session port is a runtime value from the broker.
- **`src/lib/connector/repair.ts`**: already bundles `captivo-kasm` with
  `--shm-size=1g` (needed for multiple Chromium). `MAX_SESSIONS` default 5 is baked
  into the image; no env wiring needed unless overriding.
- **Session page** iframe (`src="/kasm-tunnel/?site=…&path=kasm-tunnel/websockify"`),
  manager, Prisma schema: no changes.

## Data flow

1. Vendor opens the hi-fi ISOLATED site → session page renders the iframe
   `/kasm-tunnel/?site=X&path=kasm-tunnel/websockify`.
2. Browser loads the web client HTML + assets → data-plane routes these
   (non-WS) to the **hub** (6901, static). No session yet.
3. KasmVNC client opens the WS to `/kasm-tunnel/websockify` → data-plane sees the
   upgrade → `POST /session {navigateUrl}` to the broker → gets `{id, port}` →
   reverse-proxies the WS to the **per-session** port → the per-session Chromium is
   already rendering the target site, so the RFB stream shows it live.
4. Vendor interacts; the RFB rides the one long-lived WS.
5. Vendor closes the tab → WS closes → data-plane `POST /session/<id>/close` →
   broker tears the group down and frees the slot.

Concurrent vendors each get steps 3–5 independently on distinct ports/displays,
up to `MAX_SESSIONS`; the `MAX_SESSIONS+1`-th gets `503 "at capacity"`.

## Error handling / edge cases

- **At capacity**: broker `503 capacity` → data-plane `503 "isolated browser at
  capacity"` surfaced to the vendor.
- **Stale X lock** on a reused display: cleared before every spawn (baked in).
- **WS ends**: session closed; if the close call fails, the TTL reaper reclaims.
- **Data-plane crash mid-session**: orphan `Xvnc`/Chromium reclaimed by the 4 h
  reaper (same safety net as A2).
- **Hub down**: web client requests `502` (existing behaviour).
- **Broker/spawn failure**: `502`/`503` to the vendor; nothing leaks (no slot taken
  on a failed allocate).

## Testing / verification

- **Go unit tests** (`dataplane/kasmtunnel_test.go`):
  - `TestKasmPathStrip` — keep.
  - Replace `TestKasmSingleFlight` (single-flight removed) with a broker-client
    test: `openKasmSession` parses `{id, port}` from a `201`, and surfaces `503`
    capacity as a non-error status (mirror `isolated_test.go`).
  - `kasmSessionAddr` host-preserved / port-swapped.
- **Local concurrency spike** (no Python test framework in the repo — same as A2):
  build the image, run with `MAX_SESSIONS=3`, open 3 sessions → three distinct
  `Xvnc` on ports 6902/6903/6904, 4th → `503 capacity`, close one → slot freed and
  reused, profile removed.
- `pnpm build` (manager unaffected but keep green), `go build ./...` + `go test ./...`.

## Deployment

Data-plane + `captivo-kasm` image only (no schema, manager unchanged). Bump
`dataplane` and `kasm-browser` images; **the gateway host's connector must Update**
to pull the new `captivo-kasm:latest` (bundled `:latest`, pulled on install/update
per `repair.ts`). Prod `ISOLATED_ENABLED` stays as set. English `gh release edit`
note. No Claude signature. Gate-A (operator): two vendors open the hi-fi ISOLATED
site at the same time → both render on separate profiles; exceeding `MAX_SESSIONS`
shows "at capacity"; closing frees a slot.

## Global constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Transport B must not depend on `isolated.go` (transport A, deleted after B3).
- Deploy requires explicit user approval; every tag gets an English user-focused
  `gh release edit` note.
