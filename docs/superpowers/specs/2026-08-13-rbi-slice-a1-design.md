# RBI (Isolated Browser) — Slice A1: Walking Skeleton — Design

**Status:** Approved (brainstorm 2026-08-13). Approach A (RBI on the existing guacd/VNC gateway pipeline). Slice A1 of 3 (A1 skeleton · A2 concurrency broker · A3 hardening).
**Backlog:** Pro layer, RBI feature (see `session-recording-isolation-architecture-note.md` + memory `project_captivo_access`).
**Ships as:** v0.58.0 (schema + manager + dataplane + new browser image).

## What this is (and is NOT)

Remote Browser Isolation: run a web app inside a **containerized browser on-prem next to the connector**, and stream only its screen to the vendor — the app never runs on the vendor's device. A1 is the **walking skeleton**: prove the entire pipeline end-to-end with the least-risky transport (our existing guacd **VNC** gateway), single concurrent session.

**Honest scope caveat (agreed):** A1's feel is VNC (remote-desktop), NOT the native-browser feel — that is the future **B (Neko/WebRTC)** transport upgrade. A1 proves the wiring, not the feel.

**In A1:**
- New `accessMode = ISOLATED` (additive enum) + admin site form + launch flow.
- A browser container image (`captivo-access-browser`): Xvfb + Chromium (kiosk) + x11vnc + a tiny in-container control server for navigate/reset.
- Data-plane `guac-tunnel` ISOLATED branch: navigate the browser to the site's URL, then VNC-relay through guacd — reusing session UI, audit, and the descriptor path.
- Single concurrent ISOLATED session (a single-flight guard prevents a second viewer sharing the same display).

**NOT in A1 (explicitly deferred):**
- **Concurrency + true per-session isolation** → **A2** (in-container per-session process broker: fresh Xvfb+Chromium+x11vnc per session, port allocation, profile wipe, reaping — no docker socket).
- **Data-leak controls** (clipboard/download policy, idle-kill, session caps), recording verification, admin polish → **A3**.
- Neko/WebRTC transport → future **B**.

## Architecture (reuses the gateway pipeline)

```
vendor browser ──WS /guac-tunnel──▶ data-plane ──yamux (connector)──▶ guacd ──VNC──▶ [captivo-browser container]
                                          │                                              (Xvfb :1 + Chromium kiosk + x11vnc :5900)
                                          └── navigate (dial browser :7900) ─────────────▶ control server → CDP Page.navigate(upstreamUrl)
```

The browser container lives on the connector host's `captivo-gateway` network (same place guacd already runs), reachable by guacd (VNC 5900) and by the data-plane's connector-relayed dial (control 7900). Credentials/data never leave the customer network — **KVKK/5651 wedge preserved**.

## Components

### 1. Browser container image — `captivo-access-browser` (new, ghcr)

New `browser/Dockerfile` published by `.github/workflows/publish.yml` (add `browser` to the image matrix → `ghcr.io/kurtserdar/captivo-access-browser`). Contents:
- `Xvfb :1` (headless X display, e.g. 1280×800×24), a minimal WM (fluxbox) optional.
- `chromium --kiosk --no-first-run --disable-translate --remote-debugging-port=9222 about:blank` on `DISPLAY=:1`, with a throwaway `--user-data-dir=/profile`. Remote-debugging bound to **localhost only** (never exposed outside the container).
- `x11vnc -display :1 -forever -shared -nopw -rfbport 5900` (no VNC password — the port is internal-only on `captivo-gateway`, never host-published; A3 may add a shared secret).
- A tiny **control server** (`:7900`, plain HTTP, localhost+container-net only) exposing:
  - `GET /navigate?url=<abs-url>` → validates the URL is `http(s)://`, then drives Chromium via CDP (`Page.navigate`). Returns 200/400.
  - `POST /reset` → CDP `Storage.clearDataForOrigin`/new-context or wipe `/profile` + relaunch Chromium to `about:blank` (A1: best-effort cookie/storage clear; full per-session fresh profile is A2).
- An entrypoint script (supervisord or a small shell) starts Xvfb → chromium → x11vnc → control server.

The image is **operator-run on the gateway host** (like guacd), not by us.

### 2. Deploy / setup

Extend the gateway pack (`deploy/gateway/` + `deploy/gateway/setup.sh`, and/or `src/lib/connector/repair.ts`'s gateway block) to run `captivo-access-browser` alongside guacd on the `captivo-gateway` network with the fixed name **`captivo-browser`** (VNC 5900, control 7900, both unpublished). The connector's `ALLOWED_TARGETS` (if set) must include `captivo-browser:5900` and `captivo-browser:7900` — document it (guacd:4822 already needs the same).

### 3. Schema — `prisma/schema.prisma`

`enum SiteAccessMode { TRANSPARENT GATEWAY ISOLATED }` (additive; `db push`/migrate). No new model — an ISOLATED Site reuses `upstreamUrl` (the internal address to open) and has `hostname = null` and **no `VaultCredential`** (nothing to authenticate to; the browser just opens a URL).

### 4. Site model + form — `src/lib/site/validate.ts`, `src/app/(app)/admin/sites/site-form.tsx`

- `validateSiteInput` gains an ISOLATED branch: requires `upstreamUrl` (absolute http(s)); `hostname = null`; no vault fields; `recordSessions` allowed (guacd-native, like GATEWAY).
- Site form "Type" selector gains **"Isolated browser (Pro)"** (shown only when the `ISOLATED_ENABLED` gate is on, mirroring how `nativeGateway` gates GATEWAY). Fields: Name + Internal URL (+ recording toggle). No connector-credential section.

### 5. Capability gate — `src/lib/isolation/enabled.ts` (new)

`isolationEnabled()` → `process.env.ISOLATED_ENABLED` truthy (default **off**), mirroring `src/lib/vault/enabled.ts` / `recordingEnabled()`. Gates: the site-form option, create/update server-side (reject ISOLATED when off), and the descriptor.

### 6. Manager descriptor — `src/app/api/internal/gateway/descriptor/route.ts`

Add an ISOLATED branch **before** the vault lookup: if `site.accessMode === "ISOLATED"` (and `isolationEnabled()`), return **without** a `VaultCredential`:
```ts
{ protocol: "vnc", params: {}, targetHost: <browser host>, targetPort: <browser vnc port>,
  username: "", secret: "", secretKind: "NONE",
  navigateUrl: site.upstreamUrl, guacdAddress, connectorId: site.connectorId,
  record: recordingEnabled() && site.recordSessions }
```
The browser host/port come from manager env `ISOLATED_BROWSER_ADDR` (default `captivo-browser:5900`) and control from `ISOLATED_BROWSER_CONTROL_ADDR` (default `captivo-browser:7900`), returned in the descriptor. Access is still grant-checked via `evaluateAccess` exactly as GATEWAY.

### 7. Data-plane — `dataplane/guactunnel.go`, `dataplane/controlclient.go`

- `GatewayDescriptor` (controlclient) gains `navigateUrl` + `browserControlAddr` fields (empty for RDP/SSH/VNC gateways).
- `serveGuacTunnel`: when `navigateUrl != ""` (ISOLATED):
  1. **Single-flight guard:** an atomic "one ISOLATED session at a time" flag on the hub; if already busy, `503 isolated browser in use` (prevents a second x11vnc viewer sharing the display — a data leak). Released on disconnect.
  2. **Navigate:** `st, _ := dialGuacd(sess, browserControlAddr)` (generic relay stream), write `GET /reset` then `GET /navigate?url=<navigateUrl>` as minimal HTTP/1.0, read the status, close. Best-effort but log failures.
  3. Proceed with the **existing** VNC handshake to guacd (`select vnc` → args → size → `connect` to the browser VNC target). No credential injected (VNC no-pw).
  4. On teardown, best-effort `POST /reset` so the next session starts clean.
- Everything else in `serveGuacTunnel` (auth, registry, relay, audit observer, recording) is unchanged.

### 8. Launch + UI — `src/lib/portal/launch-href.ts`, session page

`launchHref`: `accessMode === "GATEWAY" || accessMode === "ISOLATED"` → `/gateway/${siteId}/session`. The session page + `session-client.tsx` are protocol-agnostic (guacamole-common-js renders whatever guacd streams), so **no client change** — a VNC stream of the browser renders in the same full-screen page. The portal card chip reads "ISOLATED" (or "WEB (isolated)").

## Data flow (ISOLATED session)

1. Vendor clicks **Open** on an ISOLATED grant → `/gateway/[siteId]/session`.
2. Page opens WS `/guac-tunnel?site=…`; data-plane authenticates `ca_session` → userID.
3. `GatewayDescriptor` → grant-checked; returns VNC target = `captivo-browser:5900`, `navigateUrl = upstreamUrl`, control addr, record.
4. Single-flight guard acquired; data-plane dials `captivo-browser:7900` through the connector → `/reset` + `/navigate?url=upstreamUrl` → Chromium loads the internal app.
5. Data-plane dials guacd, drives the VNC handshake to `captivo-browser:5900`, relays the stream to the vendor. Session recorded (guacd-native) if enabled; audited as today.
6. Vendor sees the internal app in a contained browser; downloads/cookies/JS stay in the container. On disconnect: single-flight released, browser reset.

## Non-goals / guardrails

- **Additive only:** TRANSPARENT and GATEWAY are untouched (no behavior change; regression-test both).
- **Single concurrent ISOLATED session in A1** — enforced by the single-flight guard; real concurrency is A2. Do not ship ISOLATED_ENABLED on in prod expecting multi-user until A2.
- No docker socket anywhere (A1 uses a persistent container; A2's broker spawns processes *inside* it).
- Chromium remote-debugging (9222) is **localhost-in-container only**; only the minimal control server (7900) is reachable, and only over the internal `captivo-gateway` net via the connector.
- Pro-gated (`ISOLATED_ENABLED`, default off).

## Testing

- **Unit (manager):** `validateSiteInput` ISOLATED branch (requires upstreamUrl, rejects hostname/vault, gate off → rejected); `launchHref` ISOLATED → session path; `isolationEnabled()`; descriptor ISOLATED shape (mock). Keep parity with existing gateway tests.
- **Unit (dataplane, Go):** navigate request builder (URL validation, HTTP line format); single-flight guard (second acquire fails, release re-allows).
- **Local spike (controller-run, headless where possible):** build `captivo-access-browser`; `docker run` it; confirm x11vnc reachable + control `/navigate?url=` drives Chromium (check via CDP/`/json`); a guacd 1.6.0 → browser VNC handshake reaches READY (mirror the native-gateway spike).
- `pnpm test` + `pnpm build` green.
- **Gate A (operator-run, real browser, user's host):** configure an ISOLATED site (internal wiki URL) → vendor Open → the wiki renders in the streamed browser; a download inside it stays in the container (not on the vendor device); a second simultaneous Open returns "in use"; recording (if on) produces a session. TRANSPARENT + GATEWAY still work.

## Deploy

**v0.58.0** — schema (accessMode enum) → **manager + migrate bump + `docker compose run --rm access-migrate`**; **dataplane bump** (guactunnel ISOLATED branch); publish the new **`captivo-access-browser`** image; operator adds the browser container to the gateway host. Verify `/login` 200 + `APP_VERSION`; then the local spike + Gate A; then an English `gh release edit` note (Pro: isolated-browser access, opt-in). Keep `ISOLATED_ENABLED` **off** in prod until A2 (concurrency).
