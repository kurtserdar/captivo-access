# Gateway v2 — Slice C2: live view of active sessions

**Status:** approved design (2026-08-11)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Follows:** GW-C1 (native session recording — data-plane tee)
**Related future work:** C3 (recording replay event-timeline with click-to-seek) — out of scope here

## Goal

Let a console admin/auditor watch an in-progress native gateway session
(RDP/SSH/VNC) live, and let an admin take control (input hand-off) when needed.
Modeled on CyberArk PAM's "active sessions" monitor: clicking **Watch** shows the
vendor's screen **from that moment on — no past, no future**. The richer
start-to-finish replay with a seekable timeline belongs to *recordings* (C1),
not here.

## Core decision: live = from-now, no buffer

A viewer joins and receives the guacd→browser instruction stream **from the
moment they attach**. The data-plane keeps **no catch-up buffer** — this is the
CyberArk active-monitor model and it removes the memory concern entirely. The
one honest caveat: at attach time the viewer's screen may be blank until the
vendor next changes the screen (RDP only re-sends changed regions); it fills in
as the vendor works. Full start-to-finish fidelity is available separately from
the *recording* once (or while) the session is recorded.

Because there is no buffer, live view is independent of whether the session is
being recorded. Both the recorder (C1 `recWriter`) and the live hub tee from the
same guacd→browser loop in `serveGuacTunnel`.

## Roles

- **Watch (read-only):** any console user — `can(role, "read_console")` →
  ADMIN, OPERATOR, AUDITOR. STAFF/VENDOR cannot.
- **Take control:** ADMIN only — `can(role, "configure")`.

## Architecture

```
vendor browser ──WSS /guac-tunnel──► data-plane serveGuacTunnel ──► connector ──► guacd ──► RDP/SSH/VNC
                                          │  guacd→browser loop
                                          ├─ recWriter (C1, if recording)
                                          └─ SessionHub.broadcast ──► viewer channels
admin browser ──WSS /guac-view?session=─► data-plane serveGuacView ──attach viewer──┘  (read-only;
                                                                                        input gated on control)
admin browser ──HTTP /admin/live────────► manager ──DATAPLANE_INTERNAL_URL──► data-plane GET /internal/sessions
admin browser ──HTTP take/release───────► manager (RBAC+audit) ──► data-plane POST /internal/sessions/control
vendor browser ──poll /watch-status─────► manager ──► data-plane GET /internal/sessions/watch-status ──► banner
```

## Components

### 1. Active-session hub (`dataplane/sessionhub.go`, new)

An in-memory registry of live gateway sessions. No stream buffering.

- `type liveSession` holds: `id`, `siteID`, `userID`, `protocol`, `host`,
  `startedAt`, a set of viewer channels, and `controlOwner string` (userID of the
  admin holding control, or `""` for the vendor).
- `type SessionHub` (mutex-guarded map `id → *liveSession`):
  - `Register(meta) *liveSession` / `Remove(id)`
  - `List() []SessionInfo` — snapshot for the internal list endpoint.
  - `AddViewer(id, viewerUserID) (ch, detach)` / broadcast via
    `(*liveSession).broadcast(inst []byte)` fans one instruction to all viewer
    channels (non-blocking send; a slow viewer's frames are dropped, never the
    session).
  - Control: `SetControl(id, ownerUserID) error`, `ReleaseControl(id, ownerUserID)`,
    and gates:
    - `VendorInputAllowed(id) bool` → `controlOwner == ""`.
    - `ViewerInputAllowed(id, viewerUserID) bool` → `controlOwner == viewerUserID`.
  - `WatchStatus(userID, siteID) (watching bool, controlHeld bool)` — used by the
    vendor banner; resolves the vendor's own session by (userID, siteID).

### 2. Session registration + tee (`dataplane/guactunnel.go`, modify)

- On READY, `hub.Register(...)` with a fresh `sessionId`; `defer hub.Remove(id)`.
- In the guacd→browser loop, after the existing `rec.Write(inst)` (C1), add
  `ls.broadcast(inst)` so attached viewers get every instruction from attach time.
- The vendor's browser→guacd goroutine gates on control: forward vendor input to
  guacd only while `hub.VendorInputAllowed(id)` (i.e. no admin holds control).

### 3. Viewer endpoint (`dataplane/guacview.go` + `main.go` mux `/guac-view`)

`serveGuacView(hub, ctrl, w, r)`:
- `session` query param = the sessionId to watch.
- Authn: `ca_session` cookie → `ctrl.ResolveSession` → viewerUserID.
- Authz: `ctrl.ViewAuthz(viewerUserID)` (new manager call) → must allow (console
  user). Else 403.
- Attach as a viewer: `ch, detach := hub.AddViewer(session, viewerUserID)`;
  upgrade the browser WS (Subprotocols `["guacamole"]`); write each broadcast
  instruction to the WS. `defer detach()`.
- Read side (admin input): read WS messages; forward to the session's guacd conn
  **only while `hub.ViewerInputAllowed(session, viewerUserID)`** (this viewer holds
  control). Otherwise drop. This is the take-control input path.
- Requires access to the session's guacd write conn: the `liveSession` holds a
  reference to the guacd `net.Conn` (write) so a controlling viewer's input can be
  injected. Writes to guacd are serialized with the vendor loop via the session's
  write mutex.

### 4. Internal API (`dataplane/main.go`, secret-gated `:3102`)

- `GET /internal/sessions` → `[{sessionId, siteId, userId, protocol, host, startedAt, viewerCount, controlOwner}]`.
- `POST /internal/sessions/control` `{sessionId, ownerUserId, action:"take"|"release"}` → sets/clears `controlOwner`.
- `GET /internal/sessions/watch-status?userId=&siteId=` → `{watching, controlHeld}`.

### 5. Manager — active-session list + viewer + control + authz

- `src/lib/dataplane/client.ts` (new) — server-side helper calling the data-plane
  internal API via `DATAPLANE_INTERNAL_URL` (default `http://access-dataplane:3102`)
  with `x-dataplane-secret`. Functions: `listActiveSessions()`,
  `setSessionControl(sessionId, ownerUserId, action)`,
  `getWatchStatus(userId, siteId)`.
- `src/app/api/internal/gateway/view-authz/route.ts` (new) — `{userId}` →
  `{allow}` via `can(user.role, "read_console")`; `DATAPLANE_SECRET`-gated (called
  by the data-plane viewer endpoint).
- `src/app/(app)/admin/live/page.tsx` + `live-table.tsx` (new) — "Live sessions":
  lists active gateway sessions (vendor, site, protocol badge, started, viewer
  count) with a **Watch** action. `requireConsole` guard (read_console). Distinct
  from the existing auth `/admin/sessions` page.
- `src/app/live/[sessionId]/page.tsx` + `live-viewer.tsx` (new, top-level like the
  session page for fullscreen) — read-only `Guacamole.Client` pointed at
  `/guac-view?session=<id>`; a **LIVE** badge; a **Take control / Release** button
  (ADMIN only) that POSTs to the control route and, while held, attaches
  Keyboard/Mouse so input flows. Guard: `can(read_console)`.
- `src/app/api/admin/live/[sessionId]/control/route.ts` (new) — `{action}`;
  `getCurrentUser` + `can(configure)` (ADMIN); calls `setSessionControl` and
  writes an audit event (`take`/`release`).
- Nav: add "Live sessions" to the admin navigation for console users.

### 6. Vendor notification (`session-client.tsx`, modify + watch-status route)

- `src/app/api/gateway/[siteId]/watch-status/route.ts` (new) — current vendor
  user + siteId → `getWatchStatus(userId, siteId)` → `{watching, controlHeld}`.
- The vendor `GatewaySession` polls it every ~2 s and shows a banner:
  - `watching` → "This session is being monitored live."
  - `controlHeld` → "An administrator has taken control of this session." (input
    already stops server-side; the banner explains why.)

## Data flow

1. Vendor connects → `serveGuacTunnel` registers a `liveSession` (sessionId) and
   tees the guacd stream to `recWriter` (if recording) and to the hub.
2. Admin opens `/admin/live` → manager lists active sessions from the data-plane.
3. Admin clicks **Watch** → `/live/<sessionId>` opens a read-only viewer WS to
   `/guac-view`; the data-plane authorizes (read_console) and streams live
   instructions from attach time.
4. Admin (ADMIN) clicks **Take control** → control route (RBAC+audit) →
   data-plane sets `controlOwner=adminId`; the vendor's input is now gated off and
   the admin's input is forwarded to guacd. Vendor sees the "control taken" banner.
5. **Release** → `controlOwner=""`; vendor input resumes.
6. Vendor disconnects → `hub.Remove`; viewer WSs close.

## Error handling

- Broadcast is non-blocking: a slow/stuck viewer drops frames, never stalls the
  vendor session.
- Viewer auth/authz failure → WS refused (401/403); the vendor session is
  unaffected.
- Data-plane unreachable from the manager (list/control/watch-status) → the
  admin page shows an empty/"unavailable" state; nothing crashes.
- A control request for a session that ended → 404/no-op; the viewer WS closes.
- Only one `controlOwner` at a time; a second admin's take-control request while
  someone holds control is rejected until release.

## Security & audit

- Watch requires `read_console`; take-control requires `configure` (ADMIN).
- **Audit events** (tamper-evident chain): `live.watch.started` /
  `live.watch.stopped` (best-effort, on viewer attach/detach), `live.control.taken`
  / `live.control.released` (on the control route).
- Vendor is shown a visible banner while watched or controlled (transparency).
- The plaintext session credential never reaches a viewer — viewers receive only
  the rendered display stream, exactly like the vendor's browser.

## Capability gating

- Reuses `NATIVE_GATEWAY` + RBAC. No new capability env.
- New wiring env: `DATAPLANE_INTERNAL_URL` on the manager (default
  `http://access-dataplane:3102`).

## Testing

**Go (`go test ./...` in `dataplane`):**
- `SessionHub`: register/list/remove; `broadcast` fans to N viewer channels and
  drops on a full channel; `SetControl`/`ReleaseControl` transitions;
  `VendorInputAllowed` true only when `controlOwner==""`; `ViewerInputAllowed`
  true only for the owner; `WatchStatus` resolves by (userId, siteId).

**TS (vitest / build):**
- `view-authz` allows read_console roles, denies STAFF/VENDOR.
- `dataplane/client.ts` builds the right requests (pure URL/body construction is
  unit-testable; the network call is not).

**Gate A (live, two browsers):**
1. Vendor runs an RDP session; admin opens `/admin/live` → the session is listed
   with an RDP badge. Click **Watch** → the admin sees the vendor's screen update
   live (fills in as the vendor works). Read-only: admin input does nothing.
2. Admin clicks **Take control** → the vendor's input stops and the vendor sees
   the "control taken" banner; the admin's input now drives the session. **Release**
   → the vendor regains control and the banner clears. Audit events recorded.
3. Auditor can Watch but has no Take-control button; STAFF/VENDOR cannot reach
   `/admin/live` or `/live/[id]`.

## Deploy notes

- Data-plane changed → bump `access-dataplane`. Manager changed → bump
  `access-manager`. **No schema change** → no `access-migrate` run.
- Set `DATAPLANE_INTERNAL_URL` on the manager (compose-internal
  `http://access-dataplane:3102`).
- Ensure the front nginx proxies `/guac-view` with WebSocket upgrade, exactly like
  `/guac-tunnel`.
- English-only strings + GitHub Release note (`gh release edit`).

## File map

**Create (data-plane):** `dataplane/sessionhub.go` (+ `sessionhub_test.go`),
`dataplane/guacview.go`.
**Modify (data-plane):** `dataplane/guactunnel.go` (register + broadcast + vendor
input gate), `dataplane/controlclient.go` (`ViewAuthz`), `dataplane/main.go` (mux
`/guac-view`, internal endpoints, pass hub through), `dataplane/registry.go` or
`guactunnel.go` for the guacd write-conn reference on `liveSession`.

**Create (manager):** `src/lib/dataplane/client.ts`,
`src/app/api/internal/gateway/view-authz/route.ts`,
`src/app/(app)/admin/live/page.tsx`, `src/app/(app)/admin/live/live-table.tsx`,
`src/app/live/[sessionId]/page.tsx`, `src/app/live/[sessionId]/live-viewer.tsx`,
`src/app/api/admin/live/[sessionId]/control/route.ts`,
`src/app/api/gateway/[siteId]/watch-status/route.ts`.
**Modify (manager):** `src/app/gateway/[siteId]/session/session-client.tsx` (watch
banner), admin nav (add "Live sessions"), `src/app/globals.css` (viewer/banner
styles).
