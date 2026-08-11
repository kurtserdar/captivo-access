# C2 live-view idle catch-up — guacd connection sharing

**Status:** approved design (2026-08-11)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Replaces:** the C2 data-plane fan-out viewer path (the `SessionHub` broadcast /
viewer-channel / `lastSize` bootstrap machinery introduced in GW-C2)

## Goal

When an admin opens a live view of an in-progress remote-desktop session, show
the **current full screen immediately** — even when the vendor is idle — instead
of a black screen that only fills in as the vendor moves things.

## Root cause + solution

RDP (via guacd) sends the full first frame right after `connect`, then only
**changed regions**. The current fan-out viewer joins mid-stream and receives
only post-attach deltas, so an idle screen renders black. `ready`+`size`
bootstrap sizes the display but cannot reconstruct the current pixels — a
structural limit of fan-out.

**guacd connection sharing** solves it natively. guacd assigns every connection a
unique **connection ID** (the first argument of the `ready` instruction, e.g.
`$260d…`). A second guacd client that issues `select <connID>` — the connection
ID in place of a protocol name — **joins** that existing connection, and guacd
immediately sends the joining user a **full keyframe of the current display**.
That keyframe is exactly the "current screen on join" we need, and it comes from
guacd, so it works for idle screens and needs no server-side buffer.

This reworks the viewer path from fan-out to a real second guacd connection, and
in doing so **removes** the fan-out hub machinery (broadcast, viewer channels,
`lastSize` bootstrap).

## Architecture

```
vendor browser ─WSS /guac-tunnel─► data-plane serveGuacTunnel ─► connector ─► guacd ──► RDP
                                        │ handshake → ready(connID)          (owner user)
                                        ├─ rec.Write (C1 recording, unchanged)
                                        └─ hub.Register(connID, connectorID, guacdAddr)

admin browser  ─WSS /guac-view───► data-plane serveGuacView ─► connector ─► guacd  (join user)
                                        │ select <connID> → guacd sends KEYFRAME + live
                                        └─ input forwarded only while this viewer holds control
```

Both the owner (vendor) and each join user (admin viewers) are separate guacd
connections on the **same** shared session; guacd fans the display out to each
and routes input from any of them to the target.

## Components

### 1. Capture the connection ID (`dataplane/guactunnel.go`)

The handshake already reads `op, readyArgs, err := parseInstruction(br)` where
`op == "ready"`. The connection ID is `readyArgs[0]` (guard `len(readyArgs) > 0`).

- After READY, `hub.Register(sessionID, siteID, userID, conn.Protocol, conn.Hostname, time.Now(), connID, connectorID, guacdAddr)`.
- **Remove** `ls.broadcast(inst)` from the guacd→browser loop (no fan-out).
  **Keep** `rec.Write(inst)` (C1 recording).
- The vendor's browser→guacd loop writes to its own local `guac` directly, gated
  on `ls.vendorInputAllowed()` (no shared `writeToGuac`/mutex any more).

### 2. Viewer join handshake (`dataplane/guacview.go`, rewritten)

`serveGuacView(hub, ctrl, reg, w, r)` — now needs the `Registry` to dial guacd:

- Authn/authz unchanged: `ca_session` cookie → `ctrl.ResolveSession` →
  `ctrl.ViewAuthz(viewerUserID)`.
- `ls := hub.Get(sessionID)`; read `connID, connectorID, guacdAddr` via
  `ls.shareInfo()`. If `connID == ""` (session still mid-handshake) → `409`.
- `sess := reg.Get(connectorID)`; if offline → `502`.
- `guac, err := dialGuacd(sess, guacdAddr)` — a **second** guacd stream over the
  same connector.
- **Join handshake** (mirrors the owner handshake but joins by ID):
  - `guac.Write(encodeInstruction("select", connID))`
  - read `args` → `argNames`
  - `size` (viewer viewport) / `audio` / `video` / `image`
  - `connect` = `buildConnect(argNames, GuacConn{})` — echoes `VERSION`, empty for
    the rest (a join ignores connection params; guacd only needs the VERSION echo).
  - read `ready` (the viewer's own user id; the keyframe streams immediately after).
- `ls.addViewer()` on attach, `defer ls.removeViewer()`.
- Accept the browser WS (`Subprotocols: ["guacamole"]`); send the viewer's `ready`
  to the browser, then bridge:
  - guacd→browser: `readRawInstruction` loop → WS (the keyframe is the first big
    frame, then live deltas).
  - browser→guacd: read WS; forward to `guac` only while
    `ls.viewerInputAllowed(viewerUserID)`; otherwise drop.
- `defer guac.Close()`.

### 3. Hub simplification (`dataplane/sessionhub.go`)

Remove the fan-out machinery: `viewers map[int]chan []byte`, `broadcast`,
`addViewer/removeViewer` (channel form), `lastSize`/`bootstrap`, `guac net.Conn`,
`writeMu`, `writeToGuac`, `closeAllViewers`. `liveSession` becomes:

```go
type liveSession struct {
    id, siteID, userID, protocol, host string
    startedAt                          time.Time
    connID, connectorID, guacdAddr     string
    mu                                 sync.Mutex
    controlOwner                       string
    viewers                            int
}
```

Methods:
- `Register(sessionID, siteID, userID, protocol, host string, startedAt time.Time, connID, connectorID, guacdAddr string) *liveSession`
- `(*liveSession) shareInfo() (connID, connectorID, guacdAddr string)`
- `(*liveSession) addViewer()` / `removeViewer()` — increment/decrement `viewers`
- `vendorInputAllowed()`, `viewerInputAllowed(userID)`, `setControl`, `releaseControl` — unchanged behavior
- `SessionInfo.ViewerCount` = `viewers`; `WatchStatus` = `viewers > 0 && controlOwner != ""` split as today (`watching = viewers>0`, `controlHeld = controlOwner!=""`)
- `Remove` no longer closes viewer channels (there are none); viewers detach when
  their own guacd stream ends.

### 4. Input / take-control

Unchanged model, now across two guacd connections:
- Vendor input → primary guacd conn, gated by `vendorInputAllowed()` (control-free).
- Viewer input → its own (secondary) guacd conn, gated by `viewerInputAllowed(userID)`.
- The manager control route + audit events + vendor banner are unchanged.

### 5. Lifecycle / errors

- Vendor disconnects → guacd tears down the shared connection → each join user's
  guacd stream ends → viewer WS closes → `hub.Remove(sessionID)`.
- `connID == ""` (viewer opened during the owner handshake) → `409`; the client
  retries (the viewer page can reload).
- Secondary `dialGuacd` fails / connector offline → `502`; the vendor session is
  unaffected.
- Multiple viewers → each is an independent join user; guacd supports N users.

## Spike-first

The one unverified assumption is that **guacd 1.5.5 sends a keyframe when a
client joins via `select <connID>` through our tunnel**. The plan's **first task
is a spike**: capture the connID, implement the join handshake + a read-only
viewer bridge, and Gate-A validate that joining an **idle** RDP session shows the
current screen. If guacd does not send a keyframe on join, stop and revisit
(fallback: recording-seed). Only after the spike proves out do we remove the
fan-out machinery and wire take-control.

## Non-goals

- Recording of viewer (join) streams — recording tees the **primary** stream only
  (C1, unchanged).
- Changing the `/admin/live` list, control route, or vendor banner (all unchanged).
- guacd-level read-only enforcement — read-only stays enforced at the data-plane
  (drop viewer input unless controlling).

## Capability gating / config

- No new env, no schema change (no `access-migrate`).
- Data-plane only changes; manager unchanged (the viewer page + control route are
  as-is).

## Testing

**Go (`go test ./...` in `dataplane`):**
- Hub: `Register` stores `connID/connectorID/guacdAddr`; `shareInfo` returns them;
  `addViewer/removeViewer` move `viewers`; `WatchStatus` true/true with a viewer +
  control; control gating (`vendorInputAllowed` only control-free,
  `viewerInputAllowed` only for the owner). Remove the old broadcast/channel tests.

**Gate A (live, two browsers):**
1. **Idle catch-up:** vendor on an RDP session, leaves the screen static; admin
   clicks Watch → the current screen appears immediately (not black).
2. **Take control:** admin takes control → vendor input stops, admin drives; the
   admin's actions reach the target over the join connection. Release → vendor
   resumes.
3. **Multiple viewers:** two admins watch the same session; both see the screen.
4. **Teardown:** vendor disconnects → open viewers show "session ended".

## Deploy notes

- Data-plane only → bump `access-dataplane`. No manager/migrate change. Operators
  do NOT need to re-run the connector command (the connector/guacd containers are
  unchanged; guacd sharing is a protocol capability already present in 1.5.5).

## File map

**Modify:** `dataplane/guactunnel.go` (capture connID + Register with it; drop
broadcast; direct vendor-input gate), `dataplane/guacview.go` (join handshake),
`dataplane/sessionhub.go` (simplify to connID/viewers/control), `dataplane/main.go`
(pass `reg` to `serveGuacView`), `dataplane/sessionhub_test.go` (retarget tests).
