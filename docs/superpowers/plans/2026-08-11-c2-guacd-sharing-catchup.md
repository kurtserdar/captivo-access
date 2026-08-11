# C2 idle catch-up via guacd connection sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current full screen the instant an admin joins a live view — even when the vendor is idle — by having the viewer join the existing guacd connection by its connection ID (guacd sends a keyframe) instead of fanning out post-attach deltas.

**Architecture:** `serveGuacTunnel` captures guacd's connection ID from the `ready` instruction and stores it on the session. `serveGuacView` opens a *second* guacd connection over the same connector and issues `select <connID>` to join, so guacd sends it the current display state plus live updates. The fan-out `SessionHub` machinery (broadcast/viewer-channels/`lastSize`) is removed; the hub now just tracks metadata, the connection ID, viewer count, and control ownership.

**Tech Stack:** Go data-plane (under `go.work`), guacd 1.5.5 connection sharing, `coder/websocket`.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **Data-plane only** — no schema change, no manager change, **no `access-migrate`**. Operators do NOT re-run the connector command (guacd/connector containers unchanged; sharing is already in guacd 1.5.5).
- **Spike-first:** the unverified assumption is that guacd 1.5.5 sends a keyframe when a client joins via `select <connID>` through our tunnel. Task 2 Gate-A validates idle catch-up FIRST; if the joined viewer is still black on an idle screen, **STOP and revert** — the assumption failed (fallback: recording-seed, a separate design).
- **Recording (C1) is untouched** — the guacd→browser loop keeps `rec.Write`; only `ls.broadcast` is removed.
- **Verify:** `go build ./...` and `go test ./...` run from `dataplane/`.

---

### Task 1: Rework the viewer path to guacd connection sharing

**Files:**
- Modify: `dataplane/sessionhub.go`
- Test: `dataplane/sessionhub_test.go`
- Modify: `dataplane/guactunnel.go`
- Modify: `dataplane/guacview.go`
- Modify: `dataplane/main.go`

**Interfaces:**
- Consumes: `dialGuacd` (`guacdial.go`), `encodeInstruction`/`parseInstruction`/`readRawInstruction`/`buildConnect`/`GuacConn`/`qInt` (`guacproto.go`/`guactunnel.go`), `Registry.Get` (`registry.go`), `ControlClient.ResolveSession`/`ViewAuthz`.
- Produces (new hub shape):
  - `Register(sessionID, siteID, userID, protocol, host string, startedAt time.Time, connID, connectorID, guacdAddr string) *liveSession`
  - `(*liveSession) shareInfo() (connID, connectorID, guacdAddr string)`
  - `(*liveSession) addViewer()` / `removeViewer()` (integer count)
  - `vendorInputAllowed()`, `viewerInputAllowed(userID string)`, `setControl(owner) error`, `releaseControl(owner)` (unchanged behavior)
  - Removed: `broadcast`, channel-based `addViewer/removeViewer`, `bootstrap`, `lastSize`, `writeToGuac`, `closeAllViewers`, the `guac net.Conn`/`writeMu` fields.

> The three data-plane files are one compile unit (they share the hub's methods), so they change together in this task. Unit tests cover the hub; `go build` covers the wiring; Gate-A (Task 2) covers guacd behavior.

- [ ] **Step 1: Rewrite `dataplane/sessionhub.go` to the sharing shape**

Replace the whole file with:

```go
package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var (
	errControlHeld = errors.New("control already held")
	errNoSession   = errors.New("session not found")
)

// SessionInfo is the JSON snapshot of one active session for the internal list API.
type SessionInfo struct {
	SessionID    string    `json:"sessionId"`
	SiteID       string    `json:"siteId"`
	UserID       string    `json:"userId"`
	Protocol     string    `json:"protocol"`
	Host         string    `json:"host"`
	StartedAt    time.Time `json:"startedAt"`
	ViewerCount  int       `json:"viewerCount"`
	ControlOwner string    `json:"controlOwner"`
}

// liveSession is one in-progress gateway session. Viewers join guacd's shared
// connection directly (by connID) rather than being fanned out here, so this
// holds only what viewers need to dial + join, plus control state.
type liveSession struct {
	id, siteID, userID, protocol, host string
	startedAt                          time.Time
	connID, connectorID, guacdAddr     string

	mu           sync.Mutex
	controlOwner string // userID holding control, or "" for the vendor
	viewers      int    // attached live viewers (for the console list)
}

func (ls *liveSession) shareInfo() (string, string, string) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.connID, ls.connectorID, ls.guacdAddr
}

func (ls *liveSession) addViewer() {
	ls.mu.Lock()
	ls.viewers++
	ls.mu.Unlock()
}

func (ls *liveSession) removeViewer() {
	ls.mu.Lock()
	if ls.viewers > 0 {
		ls.viewers--
	}
	ls.mu.Unlock()
}

func (ls *liveSession) vendorInputAllowed() bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.controlOwner == ""
}

func (ls *liveSession) viewerInputAllowed(userID string) bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return userID != "" && ls.controlOwner == userID
}

func (ls *liveSession) setControl(owner string) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if ls.controlOwner != "" && ls.controlOwner != owner {
		return errControlHeld
	}
	ls.controlOwner = owner
	return nil
}

func (ls *liveSession) releaseControl(owner string) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if ls.controlOwner == owner {
		ls.controlOwner = ""
	}
}

// SessionHub is a thread-safe registry of active gateway sessions.
type SessionHub struct {
	mu sync.RWMutex
	m  map[string]*liveSession
}

func NewSessionHub() *SessionHub { return &SessionHub{m: map[string]*liveSession{}} }

func newSessionID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func (h *SessionHub) Register(sessionID, siteID, userID, protocol, host string, startedAt time.Time, connID, connectorID, guacdAddr string) *liveSession {
	ls := &liveSession{
		id: sessionID, siteID: siteID, userID: userID, protocol: protocol, host: host,
		startedAt: startedAt, connID: connID, connectorID: connectorID, guacdAddr: guacdAddr,
	}
	h.mu.Lock()
	h.m[sessionID] = ls
	h.mu.Unlock()
	return ls
}

func (h *SessionHub) Get(id string) *liveSession {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.m[id]
}

func (h *SessionHub) Remove(id string) {
	h.mu.Lock()
	delete(h.m, id)
	h.mu.Unlock()
}

func (h *SessionHub) List() []SessionInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]SessionInfo, 0, len(h.m))
	for _, ls := range h.m {
		ls.mu.Lock()
		out = append(out, SessionInfo{
			SessionID: ls.id, SiteID: ls.siteID, UserID: ls.userID, Protocol: ls.protocol,
			Host: ls.host, StartedAt: ls.startedAt, ViewerCount: ls.viewers, ControlOwner: ls.controlOwner,
		})
		ls.mu.Unlock()
	}
	return out
}

func (h *SessionHub) SetControl(id, ownerUserID string) error {
	ls := h.Get(id)
	if ls == nil {
		return errNoSession
	}
	return ls.setControl(ownerUserID)
}

func (h *SessionHub) ReleaseControl(id, ownerUserID string) {
	if ls := h.Get(id); ls != nil {
		ls.releaseControl(ownerUserID)
	}
}

func (h *SessionHub) WatchStatus(userID, siteID string) (bool, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ls := range h.m {
		if ls.userID == userID && ls.siteID == siteID {
			ls.mu.Lock()
			watching := ls.viewers > 0
			controlHeld := ls.controlOwner != ""
			ls.mu.Unlock()
			return watching, controlHeld
		}
	}
	return false, false
}
```

- [ ] **Step 2: Retarget `dataplane/sessionhub_test.go` to the new shape**

Replace the whole file with:

```go
package main

import (
	"testing"
	"time"
)

func TestHubRegisterListRemove(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "vendor1", "rdp", "10.0.0.5", time.Unix(0, 0), "$conn1", "connA", "cap-guacd:4822")
	if ls == nil || h.Get("s1") == nil {
		t.Fatal("expected session registered")
	}
	cid, connector, addr := ls.shareInfo()
	if cid != "$conn1" || connector != "connA" || addr != "cap-guacd:4822" {
		t.Fatalf("shareInfo = %q %q %q", cid, connector, addr)
	}
	list := h.List()
	if len(list) != 1 || list[0].SessionID != "s1" || list[0].ViewerCount != 0 {
		t.Fatalf("unexpected list: %+v", list)
	}
	h.Remove("s1")
	if h.Get("s1") != nil || len(h.List()) != 0 {
		t.Fatal("expected session removed")
	}
}

func TestHubViewerCount(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), "$c", "conn", "g:4822")
	ls.addViewer()
	ls.addViewer()
	if h.List()[0].ViewerCount != 2 {
		t.Fatalf("viewer count = %d", h.List()[0].ViewerCount)
	}
	ls.removeViewer()
	if h.List()[0].ViewerCount != 1 {
		t.Fatalf("viewer count after remove = %d", h.List()[0].ViewerCount)
	}
}

func TestHubControlGating(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), "$c", "conn", "g:4822")
	if !ls.vendorInputAllowed() {
		t.Fatal("vendor input should be allowed with no controller")
	}
	if err := h.SetControl("s1", "adminA"); err != nil {
		t.Fatalf("take control: %v", err)
	}
	if ls.vendorInputAllowed() {
		t.Fatal("vendor input must be blocked while admin controls")
	}
	if !ls.viewerInputAllowed("adminA") || ls.viewerInputAllowed("adminB") {
		t.Fatal("only the controller's input is allowed")
	}
	if err := h.SetControl("s1", "adminB"); err == nil {
		t.Fatal("second controller must be rejected")
	}
	h.ReleaseControl("s1", "adminA")
	if !ls.vendorInputAllowed() {
		t.Fatal("vendor input should resume after release")
	}
}

func TestHubWatchStatus(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "vendor1", "rdp", "h", time.Unix(0, 0), "$c", "conn", "g:4822")
	if w, c := h.WatchStatus("vendor1", "site1"); w || c {
		t.Fatal("no viewers, no control -> false/false")
	}
	ls.addViewer()
	_ = h.SetControl("s1", "adminA")
	if w, c := h.WatchStatus("vendor1", "site1"); !w || !c {
		t.Fatal("viewer + control -> true/true")
	}
	if w, _ := h.WatchStatus("other", "site1"); w {
		t.Fatal("watch-status must match the vendor's own session")
	}
}
```

- [ ] **Step 3: Update `dataplane/guactunnel.go` — capture connID, drop broadcast, direct vendor input**

The owner handshake already parses the `ready` reply into `readyArgs`. Change the registration + loop:

Replace the registration block (the `sessionID := newSessionID()` … `log.Printf("… live session id=%s" …)` lines) with:

```go
	connID := ""
	if len(readyArgs) > 0 {
		connID = readyArgs[0] // guacd connection ID — the share key for viewers
	}
	sessionID := newSessionID()
	ls := hub.Register(sessionID, siteID, userID, conn.Protocol, conn.Hostname, time.Now(), connID, connectorID, guacdAddr)
	defer hub.Remove(sessionID)
	log.Printf("guac-tunnel site=%s: live session id=%s connID=%s", siteID, sessionID, connID)
```

In the guacd→browser goroutine, remove the `ls.broadcast(inst)` line (keep `rec.Write`):

```go
			if rec != nil {
				rec.Write(inst)
			}
			if werr := c.Write(ctx, websocket.MessageText, inst); werr != nil {
				errc <- werr
				return
			}
```

In the browser→guacd (vendor input) goroutine, write to the local `guac` directly (no more `ls.writeToGuac`):

```go
			if !ls.vendorInputAllowed() {
				continue // an admin has taken control; drop vendor input
			}
			if _, werr := guac.Write(data); werr != nil {
				errc <- werr
				return
			}
```

- [ ] **Step 4: Rewrite `dataplane/guacview.go` — join by connection ID**

Replace the whole file with:

```go
package main

import (
	"bufio"
	"context"
	"log"
	"net/http"

	"github.com/coder/websocket"
)

// serveGuacView attaches a viewer to an active gateway session by JOINING guacd's
// shared connection (select <connID>). guacd sends the joining user the current
// display keyframe, then live updates — so an idle screen is shown immediately.
// The viewer is read-only unless it holds control, in which case its input is
// forwarded to guacd (which routes it to the target, shared with the vendor).
func serveGuacView(hub *SessionHub, ctrl *ControlClient, reg *Registry, w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session")
	if sessionID == "" {
		http.Error(w, "missing session", http.StatusBadRequest)
		return
	}
	ck, err := r.Cookie("ca_session")
	if err != nil || ck.Value == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	viewerUserID, _, err := ctrl.ResolveSession(ck.Value)
	if err != nil || viewerUserID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	allow, err := ctrl.ViewAuthz(viewerUserID)
	if err != nil || !allow {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	ls := hub.Get(sessionID)
	if ls == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	connID, connectorID, guacdAddr := ls.shareInfo()
	if connID == "" {
		http.Error(w, "session not ready", http.StatusConflict)
		return
	}
	sess := reg.Get(connectorID)
	if sess == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}
	guac, err := dialGuacd(sess, guacdAddr)
	if err != nil {
		log.Printf("guac-view session=%s: dialGuacd(%s) failed err=%v", sessionID, guacdAddr, err)
		http.Error(w, "guacd unreachable", http.StatusBadGateway)
		return
	}
	defer guac.Close()

	// Join the existing connection by its ID. guacd replies with args, we echo the
	// handshake, and on `ready` guacd streams the current keyframe + live updates.
	br := bufio.NewReader(guac)
	if _, err := guac.Write(encodeInstruction("select", connID)); err != nil {
		http.Error(w, "handshake", http.StatusBadGateway)
		return
	}
	op, argNames, err := parseInstruction(br)
	if err != nil || op != "args" {
		log.Printf("guac-view session=%s: expected args got op=%q err=%v", sessionID, op, err)
		http.Error(w, "handshake args", http.StatusBadGateway)
		return
	}
	_, _ = guac.Write(encodeInstruction("size", qInt(r, "w", 1280, 640, 5120), qInt(r, "h", 800, 480, 2880), qInt(r, "dpi", 96, 72, 240)))
	_, _ = guac.Write(encodeInstruction("audio"))
	_, _ = guac.Write(encodeInstruction("video"))
	_, _ = guac.Write(encodeInstruction("image"))
	if _, err := guac.Write(buildConnect(argNames, GuacConn{})); err != nil {
		http.Error(w, "connect", http.StatusBadGateway)
		return
	}
	op, readyArgs, err := parseInstruction(br)
	if err != nil || op != "ready" {
		log.Printf("guac-view session=%s: expected ready got op=%q err=%v", sessionID, op, err)
		http.Error(w, "not ready", http.StatusBadGateway)
		return
	}
	log.Printf("guac-view session=%s viewer=%s: joined connID=%s", sessionID, viewerUserID, connID)

	ls.addViewer()
	defer ls.removeViewer()

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		Subprotocols:       []string{"guacamole"},
	})
	if err != nil {
		log.Printf("guac-view session=%s: ws accept failed err=%v", sessionID, err)
		return
	}
	c.SetReadLimit(-1)
	defer c.CloseNow()
	ctx := context.Background()

	if err := c.Write(ctx, websocket.MessageText, encodeInstruction(append([]string{"ready"}, readyArgs...)...)); err != nil {
		return
	}

	errc := make(chan error, 2)
	// guacd -> viewer browser (keyframe first, then live).
	go func() {
		for {
			inst, rerr := readRawInstruction(br)
			if rerr != nil {
				errc <- rerr
				return
			}
			if werr := c.Write(ctx, websocket.MessageText, inst); werr != nil {
				errc <- werr
				return
			}
		}
	}()
	// viewer browser -> guacd (only while this viewer holds control).
	go func() {
		for {
			_, data, rerr := c.Read(ctx)
			if rerr != nil {
				errc <- rerr
				return
			}
			if !ls.viewerInputAllowed(viewerUserID) {
				continue
			}
			if _, werr := guac.Write(data); werr != nil {
				errc <- werr
				return
			}
		}
	}()
	<-errc
}
```

- [ ] **Step 5: Pass `reg` to `serveGuacView` in `dataplane/main.go`**

Change the `/guac-view` handler registration:

```go
	mux.HandleFunc("/guac-view", func(w http.ResponseWriter, r *http.Request) { serveGuacView(hub, ctrl, reg, w, r) })
```

- [ ] **Step 6: Build + run the hub tests**

Run (from `dataplane/`): `cd dataplane && go build ./... && go test ./... && cd ..`
Expected: PASS — build clean; the 4 hub tests + all existing data-plane tests green.

- [ ] **Step 7: Commit**

```bash
git add dataplane/sessionhub.go dataplane/sessionhub_test.go dataplane/guactunnel.go dataplane/guacview.go dataplane/main.go
git commit -m "feat(gateway): live view joins guacd's shared connection (keyframe on join)"
```

---

### Task 2: Spike validation (Gate-A) + deploy

**Files:** none (operational).

This is the spike gate. The idle-catch-up check is go/no-go for the whole approach.

- [ ] **Step 1: Deploy the data-plane**

Tag + publish, then bump only `access-dataplane` on prod (no manager/migrate):

```bash
git tag v0.21.0 && git push origin main --tags   # after merge; see finishing-a-development-branch
# on prod: bump access-dataplane image to 0.21.0, docker compose pull + up -d access-dataplane
```

- [ ] **Step 2: Gate-A #1 — idle catch-up (GO / NO-GO)**

Vendor runs an RDP session and leaves the screen **static** (no mouse/keyboard).
An admin opens `/admin/live` → **Watch**. Expected: the current screen appears
within ~1s (not black).
- **If black:** guacd did not send a keyframe on join through our tunnel. STOP —
  revert the Task 1 commit (`git revert`), redeploy the prior data-plane, and
  reconvene on the recording-seed fallback. Do not proceed.
- **If the screen appears:** the approach is validated; continue.

- [ ] **Step 3: Gate-A #2 — take control**

Admin clicks **Take control** → the vendor's input stops and the admin's mouse/
keyboard drive the target (over the join connection). **Release** → the vendor
resumes. `/admin/audit` shows the take/release events.

- [ ] **Step 4: Gate-A #3 — multiple viewers + teardown**

Two admins Watch the same session → both see the screen; `/admin/live` shows the
viewer count. The vendor disconnects → open viewers show "session ended".

- [ ] **Step 5: Release notes**

`gh release edit v0.21.0` with an English, user-facing note: live view now shows
the current screen immediately (no black screen while the vendor is idle).

---

## Self-Review

**1. Spec coverage:**
- Capture connID + Register with it; drop broadcast; keep `rec.Write` → Task 1 Steps 1, 3. ✓
- Join handshake (`select <connID>` → args → size/audio/video/image → connect → ready → bridge) → Task 1 Step 4. ✓
- Hub simplification (drop fan-out; connID/connectorID/guacdAddr + viewer count + control) → Task 1 Steps 1–2. ✓
- Input/take-control across two guacd conns (vendor→primary gated, viewer→secondary gated) → Task 1 Steps 3–4. ✓
- Lifecycle/errors (connID empty → 409; connector offline → 502; dial fail → 502; teardown) → Task 1 Step 4. ✓
- `main.go` passes `reg` → Task 1 Step 5. ✓
- Spike-first (idle catch-up GO/NO-GO, revert path) → Task 2 Step 2 + Global Constraints. ✓
- Data-plane only, no migrate → Global Constraints + Task 2 Step 1. ✓
- Testing (hub unit tests; Gate-A) → Task 1 Step 2, Task 2. ✓

**2. Placeholder scan:** No TBD/TODO; all code is concrete. Task 2 is operational (deploy + manual Gate-A) with exact commands/expectations, not vague steps.

**3. Type consistency:**
- `Register(..., connID, connectorID, guacdAddr string)` (Step 1) is called exactly that way in `guactunnel.go` (Step 3). ✓
- `shareInfo() (string,string,string)` (Step 1) consumed in `guacview.go` (Step 4) as `connID, connectorID, guacdAddr`. ✓
- `addViewer()/removeViewer()` (no args, Step 1) called without args in `guacview.go` (Step 4). ✓
- `serveGuacView(hub, ctrl, reg, w, r)` (Step 4 signature) matches the `main.go` call (Step 5). ✓
- `dialGuacd`, `buildConnect(argNames, GuacConn{})`, `qInt`, `encodeInstruction`, `parseInstruction`, `readRawInstruction` all exist in the package (used identically by the owner handshake in `guactunnel.go`). ✓
- Removed methods (`broadcast`, `writeToGuac`, `bootstrap`, channel `addViewer`) have no remaining callers after Steps 3–4 (grep `broadcast\|writeToGuac\|bootstrap` in `dataplane/` returns nothing). ✓
