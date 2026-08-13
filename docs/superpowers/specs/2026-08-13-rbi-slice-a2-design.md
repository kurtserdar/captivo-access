# RBI (Isolated Browser) — Slice A2: Concurrency Broker — Design

**Status:** Approved (brainstorm 2026-08-13). In-container per-session process broker; no docker socket.
**Backlog:** Pro layer, RBI. Slice A2 of A1/A2/A3 (A1 walking skeleton shipped v0.58.0).
**Ships as:** v0.59.0 (data-plane + browser image; no schema, no manager change).

## Goal

Let **N concurrent** isolated-browser sessions run instead of A1's one-at-a-time,
**without** giving the connector a docker socket. The browser container's control
server becomes a **session broker** that spawns a fresh per-session process group
(own X display + VNC port + Chromium profile) on demand and reaps it on close; the
data-plane asks the broker for a session (getting a dynamic VNC port) instead of
sharing a single screen, and the A1 single-flight guard is removed.

Everything downstream — the guacd VNC handshake, session UI, audit, recording — is
unchanged. `MAX_SESSIONS` (default **5**) caps concurrency per browser container
(= per gateway host); a bigger host raises it via env, and adding gateway
connectors scales it linearly.

## 1. Browser container → session broker — `browser/control.py` (rewrite)

Replace A1's single-Chromium model. Internal HTTP on `:7900`:

- `POST /session` body `{"url": "<abs http(s) url>"}`:
  - Reject non-http(s) URLs → 400.
  - If active sessions ≥ `MAX_SESSIONS` → **503** `{"error":"capacity"}`.
  - Allocate the lowest free **display N** (1..MAX_SESSIONS) → VNC port **5900+N**.
  - Spawn the per-session group on `DISPLAY=:N`:
    `Xvfb :N -screen 0 1280x800x24 -nolisten tcp` · `fluxbox` · `x11vnc -display :N -forever -nopw -rfbport <590N> -quiet` · `chromium --kiosk --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --user-data-dir=/profiles/<id> <url>`.
  - Return `{"id":"<id>","vncPort":<590N>}` (201/200).
- `POST /session/<id>/close` → SIGTERM the group (then SIGKILL after a grace), `rmtree /profiles/<id>`, free the display+port. Idempotent (unknown id → 200/404, no error).
- `GET /healthz` → 200 (unchanged).
- **Remove** `/navigate` and `/reset` (A1-only; no external consumers).

State: a dict `{id → {display, port, procs[], profile, started_at}}`, guarded by a
lock. Allocation picks the lowest free display; close frees it.

**Reaper:** a daemon thread wakes periodically and closes any session older than
`MAX_SESSION_SECONDS` (default **14400** = 4h). This bounds a leak when the
data-plane dies before sending `/close`. Log each reap.

`entrypoint.sh`: drop the fixed `Xvfb :1` / `fluxbox` / `x11vnc` / control startup —
now it only `exec`s the broker (`python3 /control.py`); the broker starts all X/VNC/
Chromium processes per session. `browser/Dockerfile` is unchanged (same packages;
add nothing).

Env: `MAX_SESSIONS` (default 5), `MAX_SESSION_SECONDS` (default 14400).

## 2. Data-plane ISOLATED branch — `dataplane/guactunnel.go`, `dataplane/isolated.go`

- **Remove** the `isoSession` single-flight guard (and its package var).
- New ISOLATED flow (when `navigateUrl != ""`), before dialing guacd:
  1. Open a relay stream to `browserControlAddr` (`dialGuacd(sess, browserControlAddr)` — the generic relay).
  2. `openBrowserSession(stream, browserControlAddr, navigateUrl)` → writes `POST /session {url}` and **reads the HTTP response** (`http.ReadResponse` over a `bufio.Reader`), parsing `{id, vncPort}`. On non-200 (e.g. 503) → return that status to the vendor (`http.Error(w, "isolated browser at capacity", 503)`) and stop.
  3. Override the VNC target port: `conn.Port = strconv.Itoa(vncPort)` (host stays `captivo-browser` from the descriptor).
  4. `defer` a best-effort close: open a fresh relay stream, `buildCloseRequest(browserControlAddr, id)`, write, close.
  5. Proceed to `dialGuacd(sess, guacdAddr)` + the existing VNC handshake, which now connects guacd to `captivo-browser:<vncPort>`.
- `dataplane/isolated.go`: replace `buildNavigateRequest`/`buildResetRequest`/`isoGuard` with:
  - `openBrowserSession(rw io.ReadWriter, host, url string) (id string, vncPort int, status int, err error)` — builds the request, reads/parses the response; returns the HTTP status so the caller can surface 503.
  - `buildCloseRequest(host, id string) string`.

**No manager/descriptor change** — the descriptor still returns `targetHost=captivo-browser`, a nominal `targetPort` (overridden per session), `browserControlAddr`, and `navigateUrl`.

## 3. Caps & leak safety

- `MAX_SESSIONS=5` → N-flight cap; the broker returns 503 at the limit (data-plane surfaces it). Replaces A1's 1-flight guard.
- The reaper bounds leaks (max session lifetime). Explicit `/close` on session teardown is the normal path; the reaper is the backstop.

## Non-goals (deferred to A3)

- **Idle-kill** when the vendor disconnects (needs VNC-connection awareness in the broker; A2 relies on the data-plane's `/close` + the TTL reaper).
- Data-leak controls (clipboard/download policy), recording verification, per-session UI polish, per-user session limits.
- WebRTC/native-feel transport — that is the separate future **B**.

## Testing

- **Broker (local spike, controller-run):** build the image; `POST /session` ×3 →
  three distinct `vncPort`s + three live Chromiums on distinct displays (`pgrep`);
  `POST /session/<id>/close` → that group gone + `/profiles/<id>` wiped; a 6th
  `POST /session` at `MAX_SESSIONS=5` → **503**; a low `MAX_SESSION_SECONDS` →
  reaper kills an idle session.
- **Data-plane (Go unit):** `openBrowserSession` parses a canned `201 {id,vncPort}`
  and a `503` response (status surfaced, no panic); `buildCloseRequest` format.
- `go build ./...` + `go test ./...` green; manager `pnpm build`/`pnpm test`
  unaffected (no manager change, but run them).
- **Gate A (operator, user's host):** two vendors open ISOLATED **simultaneously**
  → both render (no "in use"); each sees its own site; closing one frees a slot;
  exceeding `MAX_SESSIONS` → "at capacity"; a crashed/abandoned session is reaped
  within the TTL. TRANSPARENT + GATEWAY unaffected.

## Deploy

**v0.59.0** — **data-plane bump** (guactunnel/isolated) + **new browser image**
(broker). No schema, no manager change. Operator: `docker compose up -d
access-dataplane` + update the gateway connector(s) to pull the new
`captivo-access-browser` (the connector recreate re-runs the bundled `docker run`).
`ISOLATED_ENABLED` stays operator-controlled. Then Gate A. English `gh release
edit` note (isolated browser now supports multiple concurrent sessions).
