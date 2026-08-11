# Gateway v2 — Slice C2: Live Session View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a console admin/auditor watch an in-progress native gateway session live (from the moment they attach, no buffer) and let an admin take control, with the vendor shown a "being watched/controlled" banner.

**Architecture:** A data-plane `SessionHub` tracks active gateway sessions; `serveGuacTunnel` registers each session and broadcasts every guacd→browser instruction to attached viewer channels. A `/guac-view` endpoint attaches a read-only viewer WS; a controlling admin's input is injected into the same guacd connection (serialized by a write mutex, gated on `controlOwner`). The manager lists sessions and drives take-control over the data-plane's secret-gated internal API.

**Tech Stack:** Go 1.2x data-plane (under `go.work`), Next.js 16 (App Router), guacamole-common-js, `coder/websocket`, vitest, Postgres 16.

## Global Constraints

- **English only** — every user-facing string, comment, commit message, GitHub Release note.
- **No Claude signature** — no `Co-Authored-By: Claude` / "Generated with" lines.
- **No schema change** — nothing in `prisma/schema.prisma`; **no `access-migrate` run** on deploy.
- **Roles:** Watch (read-only) requires `can(role, "read_console")` (ADMIN/OPERATOR/AUDITOR). Take-control requires `can(role, "configure")` (ADMIN).
- **Live = from-now, no buffer** — the data-plane keeps NO catch-up buffer; viewers get instructions only from attach time.
- **Broadcast is non-blocking** — a slow/full viewer channel drops frames; it must NEVER block the vendor session.
- **Capability env reuse:** `NATIVE_GATEWAY` gates the gateway. New wiring env: `DATAPLANE_INTERNAL_URL` on the manager (default `http://access-dataplane:3102`); the manager authenticates to the data-plane internal API with the existing `DATAPLANE_SECRET` via the `x-dataplane-secret` header.
- **Data-plane internal API paths are root-relative** (existing endpoints are `/proxy`, `/probe`, `/kick`…). New ones: `/sessions`, `/sessions/control`, `/sessions/watch-status`.
- **Verify commands:** Go build `go build ./...` and Go tests `go test ./...` run **from `dataplane/`**. TS build `pnpm build`; TS tests `pnpm test`.
- **Deploy:** bump `access-dataplane` + `access-manager` (no migrate). Ensure the front nginx proxies `/guac-view` with WebSocket upgrade exactly like `/guac-tunnel`.

---

### Task 1: `SessionHub` (data-plane) — the live-session registry

**Files:**
- Create: `dataplane/sessionhub.go`
- Test: `dataplane/sessionhub_test.go`

**Interfaces:**
- Produces:
  - `type SessionInfo struct` with JSON tags `sessionId, siteId, userId, protocol, host, startedAt, viewerCount, controlOwner`.
  - `type liveSession` with methods `broadcast([]byte)`, `addViewer() (int, chan []byte)`, `removeViewer(int)`, `writeToGuac([]byte) error`, `vendorInputAllowed() bool`, `viewerInputAllowed(userID string) bool`, `setControl(owner string) error`, `releaseControl(owner string)`.
  - `type SessionHub` with `NewSessionHub() *SessionHub`, `Register(sessionID, siteID, userID, protocol, host string, startedAt time.Time, guac net.Conn) *liveSession`, `Get(id string) *liveSession`, `Remove(id string)`, `List() []SessionInfo`, `SetControl(id, ownerUserID string) error`, `ReleaseControl(id, ownerUserID string)`, `WatchStatus(userID, siteID string) (watching, controlHeld bool)`, and `newSessionID() string`.
  - `var errControlHeld = errors.New("control already held")`, `var errNoSession = errors.New("session not found")`.

- [ ] **Step 1: Write the failing test**

Create `dataplane/sessionhub_test.go`:

```go
package main

import (
	"testing"
	"time"
)

func TestHubRegisterListRemove(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "vendor1", "rdp", "10.0.0.5", time.Unix(0, 0), nil)
	if ls == nil || h.Get("s1") == nil {
		t.Fatal("expected session registered")
	}
	list := h.List()
	if len(list) != 1 || list[0].SessionID != "s1" || list[0].Protocol != "rdp" {
		t.Fatalf("unexpected list: %+v", list)
	}
	h.Remove("s1")
	if h.Get("s1") != nil || len(h.List()) != 0 {
		t.Fatal("expected session removed")
	}
}

func TestHubBroadcastToViewers(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), nil)
	_, chA := ls.addViewer()
	_, chB := ls.addViewer()
	ls.broadcast([]byte("4.sync,1.0;"))
	for _, ch := range []chan []byte{chA, chB} {
		select {
		case got := <-ch:
			if string(got) != "4.sync,1.0;" {
				t.Fatalf("bad frame: %q", got)
			}
		case <-time.After(time.Second):
			t.Fatal("viewer did not receive broadcast")
		}
	}
}

func TestHubBroadcastNonBlocking(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), nil)
	id, _ := ls.addViewer() // never drained
	// Flood well past the channel buffer; broadcast must not block.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 100000; i++ {
			ls.broadcast([]byte("1.x;"))
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("broadcast blocked on a full viewer channel")
	}
	ls.removeViewer(id)
}

func TestHubControlGating(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), nil)
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
	ls := h.Register("s1", "site1", "vendor1", "rdp", "h", time.Unix(0, 0), nil)
	if w, c := h.WatchStatus("vendor1", "site1"); w || c {
		t.Fatal("no viewers, no control → false/false")
	}
	ls.addViewer()
	_ = h.SetControl("s1", "adminA")
	if w, c := h.WatchStatus("vendor1", "site1"); !w || !c {
		t.Fatal("viewer + control → true/true")
	}
	if w, _ := h.WatchStatus("other", "site1"); w {
		t.Fatal("watch-status must match the vendor's own session")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `dataplane/`): `cd dataplane && go test ./... -run TestHub`
Expected: FAIL — `NewSessionHub` undefined (does not compile).

- [ ] **Step 3: Implement `dataplane/sessionhub.go`**

```go
package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"sync"
	"time"
)

var (
	errControlHeld = errors.New("control already held")
	errNoSession   = errors.New("session not found")
)

const viewerChanBuf = 256

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

// liveSession is one in-progress gateway session. It buffers NOTHING — viewers
// receive instructions only from the moment they attach (the CyberArk
// active-monitor model). `guac` is the guacd write conn, shared with the vendor
// bridge loop; `writeMu` serializes writes so a controlling viewer's input and
// the vendor's input never interleave mid-instruction.
type liveSession struct {
	id, siteID, userID, protocol, host string
	startedAt                          time.Time

	guac    net.Conn
	writeMu sync.Mutex

	mu           sync.Mutex
	viewers      map[int]chan []byte
	nextViewer   int
	controlOwner string // userID holding control, or "" for the vendor
}

func (ls *liveSession) addViewer() (int, chan []byte) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	id := ls.nextViewer
	ls.nextViewer++
	ch := make(chan []byte, viewerChanBuf)
	ls.viewers[id] = ch
	return id, ch
}

func (ls *liveSession) removeViewer(id int) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if ch, ok := ls.viewers[id]; ok {
		close(ch)
		delete(ls.viewers, id)
	}
}

func (ls *liveSession) closeAllViewers() {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	for id, ch := range ls.viewers {
		close(ch)
		delete(ls.viewers, id)
	}
}

// broadcast copies the instruction (the source slice may be reused by the reader)
// and non-blockingly sends it to every viewer. A full channel drops the frame —
// never block the vendor session for a slow viewer.
func (ls *liveSession) broadcast(inst []byte) {
	cp := make([]byte, len(inst))
	copy(cp, inst)
	ls.mu.Lock()
	defer ls.mu.Unlock()
	for _, ch := range ls.viewers {
		select {
		case ch <- cp:
		default:
		}
	}
}

func (ls *liveSession) writeToGuac(data []byte) error {
	ls.writeMu.Lock()
	defer ls.writeMu.Unlock()
	if ls.guac == nil {
		return nil
	}
	_, err := ls.guac.Write(data)
	return err
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

func (h *SessionHub) Register(sessionID, siteID, userID, protocol, host string, startedAt time.Time, guac net.Conn) *liveSession {
	ls := &liveSession{
		id: sessionID, siteID: siteID, userID: userID, protocol: protocol, host: host,
		startedAt: startedAt, guac: guac, viewers: map[int]chan []byte{},
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
	ls := h.m[id]
	delete(h.m, id)
	h.mu.Unlock()
	if ls != nil {
		ls.closeAllViewers()
	}
}

func (h *SessionHub) List() []SessionInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]SessionInfo, 0, len(h.m))
	for _, ls := range h.m {
		ls.mu.Lock()
		out = append(out, SessionInfo{
			SessionID: ls.id, SiteID: ls.siteID, UserID: ls.userID, Protocol: ls.protocol,
			Host: ls.host, StartedAt: ls.startedAt, ViewerCount: len(ls.viewers), ControlOwner: ls.controlOwner,
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
			watching := len(ls.viewers) > 0
			controlHeld := ls.controlOwner != ""
			ls.mu.Unlock()
			return watching, controlHeld
		}
	}
	return false, false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `dataplane/`): `cd dataplane && go test ./... -run TestHub`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add dataplane/sessionhub.go dataplane/sessionhub_test.go
git commit -m "feat(gateway): SessionHub — active-session registry + viewer fan-out + control gating"
```

---

### Task 2: Register + broadcast in `serveGuacTunnel`; create hub in `main.go`

**Files:**
- Modify: `dataplane/guactunnel.go`
- Modify: `dataplane/main.go`

**Interfaces:**
- Consumes: `SessionHub` (Task 1), `newSessionID`.
- Produces: a `*SessionHub` created in `main.go` and passed to `serveGuacTunnel(ctrl, reg, hub, w, r)`; the tunnel now registers a `liveSession`, broadcasts each guacd→browser instruction, and gates vendor input on `controlOwner`.

- [ ] **Step 1: Add the hub in `main.go` and pass it to the tunnel**

In `dataplane/main.go`, just before `mux := http.NewServeMux()`:

```go
	hub := NewSessionHub()
```

Change the `/guac-tunnel` registration to pass `hub`:

```go
	mux.HandleFunc("/guac-tunnel", func(w http.ResponseWriter, r *http.Request) { serveGuacTunnel(ctrl, reg, hub, w, r) })
```

(Task 3 adds the `/guac-view` route and the internal endpoints using the same `hub`.)

- [ ] **Step 2: Update `serveGuacTunnel` signature and register the session**

In `dataplane/guactunnel.go`, change the function signature:

```go
func serveGuacTunnel(ctrl *ControlClient, reg *Registry, hub *SessionHub, w http.ResponseWriter, r *http.Request) {
```

Right after the `log.Printf("guac-tunnel site=%s: READY, bridging", siteID)` line (and the existing recorder block), register the live session:

```go
	sessionID := newSessionID()
	ls := hub.Register(sessionID, siteID, userID, conn.Protocol, conn.Hostname, time.Now(), guac)
	defer hub.Remove(sessionID)
	log.Printf("guac-tunnel site=%s: live session id=%s", siteID, sessionID)
```

(`time` is already imported in the data-plane package via other files; if `go build` reports it unused/missing in this file, add `"time"` to this file's imports.)

- [ ] **Step 3: Broadcast in the guacd→browser loop**

In the guacd→browser goroutine, after the `rec.Write(inst)` block, add the broadcast:

```go
			if rec != nil {
				rec.Write(inst)
			}
			ls.broadcast(inst)
			if werr := c.Write(ctx, websocket.MessageText, inst); werr != nil {
				errc <- werr
				return
			}
```

- [ ] **Step 4: Gate vendor input on control ownership**

Replace the browser→guacd goroutine body so vendor input is dropped while an admin holds control, and writes go through the session's serialized writer:

```go
	// browser -> guacd (vendor input; suppressed while an admin holds control)
	go func() {
		for {
			_, data, rerr := c.Read(ctx)
			if rerr != nil {
				errc <- rerr
				return
			}
			if !ls.vendorInputAllowed() {
				continue // an admin has taken control; drop vendor input
			}
			if werr := ls.writeToGuac(data); werr != nil {
				errc <- werr
				return
			}
		}
	}()
```

- [ ] **Step 5: Verify the data-plane build + existing tests**

Run (from `dataplane/`): `cd dataplane && go build ./... && go test ./... && cd ..`
Expected: PASS (build clean; Task 1 hub tests + all existing tests green).

- [ ] **Step 6: Commit**

```bash
git add dataplane/guactunnel.go dataplane/main.go
git commit -m "feat(gateway): register live sessions + broadcast stream + gate vendor input on control"
```

---

### Task 3: Viewer endpoint, internal API, and `ViewAuthz`

**Files:**
- Create: `dataplane/guacview.go`
- Modify: `dataplane/controlclient.go`
- Modify: `dataplane/main.go`

**Interfaces:**
- Consumes: `SessionHub` (Task 1); `ControlClient.ResolveSession` (existing); `coder/websocket`.
- Produces: `serveGuacView(hub *SessionHub, ctrl *ControlClient, w, r)`; `ControlClient.ViewAuthz(userID string) (bool, error)`; internal routes `/sessions`, `/sessions/control`, `/sessions/watch-status` on the `:3102` mux.

- [ ] **Step 1: Add `ViewAuthz` to the control client**

In `dataplane/controlclient.go`, add (mirrors `ResolveSession`'s error handling):

```go
// ViewAuthz asks the manager whether a user may watch live sessions (read_console).
func (c *ControlClient) ViewAuthz(userID string) (bool, error) {
	var out struct {
		Allow bool `json:"allow"`
	}
	if err := c.post("/api/internal/gateway/view-authz", map[string]string{"userId": userID}, &out); err != nil {
		if isHTTPStatus(err) {
			return false, nil
		}
		return false, err
	}
	return out.Allow, nil
}
```

- [ ] **Step 2: Implement the viewer endpoint**

Create `dataplane/guacview.go`:

```go
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/coder/websocket"
)

// serveGuacView attaches a read-only viewer to an active gateway session. The
// viewer receives the live guac stream from attach time (no history). A viewer
// that holds control (set via the manager control endpoint) has its input
// injected into the session's guacd conn; otherwise its input is dropped.
func serveGuacView(hub *SessionHub, ctrl *ControlClient, w http.ResponseWriter, r *http.Request) {
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
	viewerID, ch := ls.addViewer()
	defer ls.removeViewer(viewerID)

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
	log.Printf("guac-view session=%s viewer=%s: attached", sessionID, viewerUserID)

	errc := make(chan error, 2)
	// hub -> viewer browser
	go func() {
		for inst := range ch {
			if werr := c.Write(ctx, websocket.MessageText, inst); werr != nil {
				errc <- werr
				return
			}
		}
		errc <- nil // channel closed: session ended or viewer detached
	}()
	// viewer browser -> guacd (only while this viewer holds control)
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
			if werr := ls.writeToGuac(data); werr != nil {
				errc <- werr
				return
			}
		}
	}()
	<-errc
}
```

- [ ] **Step 3: Register the viewer route + internal endpoints in `main.go`**

In `dataplane/main.go`, add the `/guac-view` route beside `/guac-tunnel`:

```go
	mux.HandleFunc("/guac-view", func(w http.ResponseWriter, r *http.Request) { serveGuacView(hub, ctrl, w, r) })
```

Then add three handlers to the internal `in` mux (place them next to the other `in.HandleFunc(...)` blocks, before the `/healthz` one). Each repeats the existing secret check:

```go
	in.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		writeJSON(w, http.StatusOK, hub.List())
	})
	in.HandleFunc("/sessions/control", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var body struct {
			SessionID   string `json:"sessionId"`
			OwnerUserID string `json:"ownerUserId"`
			Action      string `json:"action"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.SessionID == "" || body.OwnerUserID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "reason": "invalid_body"})
			return
		}
		if body.Action == "release" {
			hub.ReleaseControl(body.SessionID, body.OwnerUserID)
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		if err := hub.SetControl(body.SessionID, body.OwnerUserID); err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	in.HandleFunc("/sessions/watch-status", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		watching, controlHeld := hub.WatchStatus(r.URL.Query().Get("userId"), r.URL.Query().Get("siteId"))
		writeJSON(w, http.StatusOK, map[string]any{"watching": watching, "controlHeld": controlHeld})
	})
```

- [ ] **Step 4: Verify the data-plane build + tests**

Run (from `dataplane/`): `cd dataplane && go build ./... && go test ./... && cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dataplane/guacview.go dataplane/controlclient.go dataplane/main.go
git commit -m "feat(gateway): read-only viewer endpoint + active-session internal API"
```

---

### Task 4: Manager `view-authz` endpoint

**Files:**
- Create: `src/app/api/internal/gateway/view-authz/route.ts`

**Interfaces:**
- Consumes: `can` (`@/lib/auth/roles`), `db`.
- Produces: `POST /api/internal/gateway/view-authz` — `DATAPLANE_SECRET`-gated; `{userId}` → `{allow: boolean}` where allow = `can(role, "read_console")`.

> No unit test (secret-gated DB route, like the sibling `session/resolve` route). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Implement the route**

Create `src/app/api/internal/gateway/view-authz/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ allow: false });
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  return NextResponse.json({ allow: !!user && can(user.role, "read_console") });
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/internal/gateway/view-authz/route.ts"
git commit -m "feat(gateway): view-authz endpoint (read_console) for the data-plane viewer"
```

---

### Task 5: Manager data-plane internal client

**Files:**
- Create: `src/lib/dataplane/client.ts`

**Interfaces:**
- Produces:
  - `interface ActiveSession { sessionId; siteId; userId; protocol; host; startedAt; viewerCount; controlOwner }` (all string except `viewerCount: number`).
  - `listActiveSessions(): Promise<ActiveSession[]>` (GET `/sessions`).
  - `setSessionControl(sessionId: string, ownerUserId: string, action: "take" | "release"): Promise<{ ok: boolean; reason?: string }>` (POST `/sessions/control`).
  - `getWatchStatus(userId: string, siteId: string): Promise<{ watching: boolean; controlHeld: boolean }>` (GET `/sessions/watch-status`).

> No unit test (thin network wrapper). Verified by `pnpm build` and by its consumers (Tasks 6–8) + Gate A. Every call fails soft (returns empty/false) so an unreachable data-plane never crashes a page.

- [ ] **Step 1: Implement the client**

Create `src/lib/dataplane/client.ts`:

```ts
const BASE = () => (process.env.DATAPLANE_INTERNAL_URL ?? "http://access-dataplane:3102").replace(/\/+$/, "");
function authHeaders(): Record<string, string> {
  return { "content-type": "application/json", "x-dataplane-secret": process.env.DATAPLANE_SECRET ?? "" };
}

export interface ActiveSession {
  sessionId: string;
  siteId: string;
  userId: string;
  protocol: string;
  host: string;
  startedAt: string;
  viewerCount: number;
  controlOwner: string;
}

export async function listActiveSessions(): Promise<ActiveSession[]> {
  try {
    const res = await fetch(`${BASE()}/sessions`, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as ActiveSession[] | null;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function setSessionControl(
  sessionId: string,
  ownerUserId: string,
  action: "take" | "release",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`${BASE()}/sessions/control`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionId, ownerUserId, action }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    return (await res.json()) as { ok: boolean; reason?: string };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

export async function getWatchStatus(userId: string, siteId: string): Promise<{ watching: boolean; controlHeld: boolean }> {
  try {
    const qs = `userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}`;
    const res = await fetch(`${BASE()}/sessions/watch-status?${qs}`, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return { watching: false, controlHeld: false };
    return (await res.json()) as { watching: boolean; controlHeld: boolean };
  } catch {
    return { watching: false, controlHeld: false };
  }
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dataplane/client.ts
git commit -m "feat(gateway): manager client for the data-plane active-session API"
```

---

### Task 6: `/admin/live` page + nav

**Files:**
- Create: `src/app/(app)/admin/live/page.tsx`
- Create: `src/app/(app)/admin/live/live-table.tsx`
- Modify: `src/app/(app)/layout.tsx` (nav)
- Modify: `src/app/(app)/_shell/command-palette.tsx`

**Interfaces:**
- Consumes: `listActiveSessions` (Task 5); `getCurrentUser` + `can` for the guard.
- Produces: the "Live sessions" console page listing active gateway sessions with a **Watch** link to `/live/<sessionId>`.

> No unit test (server page + presentational table). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Implement the presentational table**

Create `src/app/(app)/admin/live/live-table.tsx`:

```tsx
"use client";
import Link from "next/link";
import { LocalTime } from "@/app/(app)/_shell/local-time";

export interface LiveRow {
  sessionId: string;
  siteName: string;
  userLabel: string;
  protocol: string;
  startedAt: string;
  viewerCount: number;
  controlled: boolean;
}

export function LiveTable({ rows }: { rows: LiveRow[] }) {
  if (rows.length === 0) return <div className="empty">No active remote-desktop sessions.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Site</th>
            <th>Type</th>
            <th>Started</th>
            <th>Watchers</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sessionId}>
              <td>{r.userLabel}</td>
              <td>{r.siteName}</td>
              <td><span className="pill">{r.protocol.toUpperCase()}</span></td>
              <td className="cell-sub"><LocalTime iso={r.startedAt} /></td>
              <td className="cell-sub">{r.viewerCount}{r.controlled ? " · controlled" : ""}</td>
              <td className="row-actions">
                <Link href={`/live/${r.sessionId}`} className="btn sm">Watch</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Implement the page (guarded by read_console)**

Create `src/app/(app)/admin/live/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/dataplane/client";
import { LiveTable, type LiveRow } from "./live-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live sessions" };

export default async function AdminLivePage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "read_console")) notFound();

  const sessions = await listActiveSessions();
  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const siteIds = [...new Set(sessions.map((s) => s.siteId))];
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]),
  );
  const sites = new Map(
    (await db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } })).map((s) => [s.id, s]),
  );

  const rows: LiveRow[] = sessions.map((s) => ({
    sessionId: s.sessionId,
    siteName: sites.get(s.siteId)?.name ?? s.host,
    userLabel: users.get(s.userId)?.name ?? users.get(s.userId)?.email ?? s.userId,
    protocol: s.protocol,
    startedAt: s.startedAt,
    viewerCount: s.viewerCount,
    controlled: s.controlOwner !== "",
  }));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Live sessions</h1>
          <p>Watch in-progress remote-desktop sessions in real time.</p>
        </div>
      </div>
      <LiveTable rows={rows} />
    </main>
  );
}
```

- [ ] **Step 3: Add the nav entry**

In `src/app/(app)/layout.tsx`, inside the `showRead` Monitoring block, add a "Live sessions" link right after the `/admin/audit` NavLink (so auditors see it too):

```tsx
            <NavLink href="/admin/live">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              Live sessions
            </NavLink>
```

In `src/app/(app)/_shell/command-palette.tsx`, add to the `PAGES` array:

```tsx
  { label: "Live sessions", href: "/admin/live", cap: "read_console" },
```

- [ ] **Step 4: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/live/page.tsx" "src/app/(app)/admin/live/live-table.tsx" "src/app/(app)/layout.tsx" "src/app/(app)/_shell/command-palette.tsx"
git commit -m "feat(gateway): Live sessions admin page + nav"
```

---

### Task 7: Viewer page + control route

**Files:**
- Create: `src/app/live/[sessionId]/page.tsx`
- Create: `src/app/live/[sessionId]/live-viewer.tsx`
- Create: `src/app/api/admin/live/[sessionId]/control/route.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `setSessionControl` (Task 5); `getCurrentUser` + `can`; `appendAuditEvents` (`@/lib/audit/append`); the data-plane `/guac-view` endpoint; guacamole-common-js (ambient `any`).
- Produces: the fullscreen read-only viewer with a **Take control / Release** button (ADMIN only), and `POST /api/admin/live/:sessionId/control` `{action}`.

> No unit test (fullscreen client + secret-gated route). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Implement the control route**

Create `src/app/api/admin/live/[sessionId]/control/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { setSessionControl } from "@/lib/dataplane/client";
import { appendAuditEvents } from "@/lib/audit/append";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "release" ? "release" : "take";

  const result = await setSessionControl(sessionId, admin.id, action);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason ?? "failed" }, { status: 409 });

  try {
    await appendAuditEvents([
      {
        userId: admin.id,
        host: "manager",
        method: "POST",
        path: `/live/${sessionId}`,
        status: 200,
        decision: "ALLOW",
        reason: action === "take" ? "Admin took control of a live session" : "Admin released control of a live session",
      },
    ]);
  } catch (err) {
    console.error("[live/control] audit append failed:", err);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement the viewer client**

Create `src/app/live/[sessionId]/live-viewer.tsx`:

```tsx
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

export function LiveViewer({ sessionId, canControl }: { sessionId: string; canControl: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const clientRef = useRef<any>(null);
  const inputRef = useRef<{ keyboard?: any; mouse?: any }>({});
  const [error, setError] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const mod: any = await import("guacamole-common-js");
      const Guacamole = mod.default ?? mod;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const tunnel = new Guacamole.WebSocketTunnel(`${proto}://${window.location.host}/guac-view`);
      const client = new Guacamole.Client(tunnel);
      clientRef.current = client;
      const fail = () => setError("The session ended or is no longer available.");
      tunnel.onerror = fail;
      client.onerror = fail;

      const display = client.getDisplay();
      const el = display.getElement();
      if (ref.current) {
        ref.current.innerHTML = "";
        ref.current.appendChild(el);
      }
      if (disposed) return;

      const fit = () => {
        const dw = display.getWidth();
        const dh = display.getHeight();
        if (dw > 0 && dh > 0) display.scale(Math.min(window.innerWidth / dw, window.innerHeight / dh));
      };
      display.onresize = fit;
      window.addEventListener("resize", fit);

      client.connect(`session=${encodeURIComponent(sessionId)}`);
    })().catch(() => setError("Couldn't start the viewer."));

    return () => {
      disposed = true;
      try {
        detachInput();
        clientRef.current?.disconnect();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function attachInput() {
    const client = clientRef.current;
    if (!client) return;
    const el = client.getDisplay().getElement();
    const Guacamole: any = (window as any).Guacamole;
    // guacamole-common-js is already loaded on the module; re-import is cached.
    import("guacamole-common-js").then((mod: any) => {
      const G = mod.default ?? mod ?? Guacamole;
      const keyboard = new G.Keyboard(document);
      keyboard.onkeydown = (k: number) => client.sendKeyEvent(1, k);
      keyboard.onkeyup = (k: number) => client.sendKeyEvent(0, k);
      const mouse = new G.Mouse(el);
      const send = (s: any) => client.sendMouseState(s);
      mouse.onmousedown = send;
      mouse.onmouseup = send;
      mouse.onmousemove = send;
      inputRef.current = { keyboard, mouse };
    });
  }
  function detachInput() {
    const { keyboard, mouse } = inputRef.current;
    if (keyboard) {
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
    }
    if (mouse) {
      mouse.onmousedown = null;
      mouse.onmouseup = null;
      mouse.onmousemove = null;
    }
    inputRef.current = {};
  }

  async function toggleControl() {
    setBusy(true);
    const action = controlling ? "release" : "take";
    try {
      const res = await fetch(`/api/admin/live/${sessionId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        if (action === "take") {
          attachInput();
          setControlling(true);
        } else {
          detachInput();
          setControlling(false);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <div className="live-badge">● LIVE{controlling ? " · CONTROLLING" : ""}</div>
      {canControl && (
        <button type="button" className="btn sm live-control" disabled={busy} onClick={toggleControl}>
          {controlling ? "Release control" : "Take control"}
        </button>
      )}
      {error && <div className="live-error">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Implement the viewer page (guarded, fullscreen, audits watch start)**

Create `src/app/live/[sessionId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { appendAuditEvents } from "@/lib/audit/append";
import { LiveViewer } from "./live-viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live session" };

export default async function LiveSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "read_console")) notFound();
  const { sessionId } = await params;

  try {
    await appendAuditEvents([
      {
        userId: user.id,
        host: "manager",
        method: "GET",
        path: `/live/${sessionId}`,
        status: 200,
        decision: "ALLOW",
        reason: "Admin opened a live session view",
      },
    ]);
  } catch {
    /* best-effort */
  }

  return <LiveViewer sessionId={sessionId} canControl={can(user.role, "configure")} />;
}
```

- [ ] **Step 4: Add viewer styling**

Append to `src/app/globals.css`:

```css
/* Live session viewer (GW-C2) */
.live-badge { position: fixed; top: 12px; left: 12px; z-index: 10; background: rgba(0,0,0,0.6); color: #ff4d4f; font: 600 12px/1 sans-serif; letter-spacing: 0.06em; padding: 6px 10px; border-radius: 6px; }
.live-control { position: fixed; top: 12px; right: 12px; z-index: 10; }
.live-error { position: fixed; inset: auto 0 0 0; color: #fff; background: rgba(0,0,0,0.7); padding: 12px; text-align: center; font-family: sans-serif; }
```

- [ ] **Step 5: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/live/[sessionId]/page.tsx" "src/app/live/[sessionId]/live-viewer.tsx" "src/app/api/admin/live/[sessionId]/control/route.ts" src/app/globals.css
git commit -m "feat(gateway): live viewer page + take/release control + watch audit"
```

---

### Task 8: Vendor watch banner + watch-status route + Gate A

**Files:**
- Create: `src/app/api/gateway/[siteId]/watch-status/route.ts`
- Modify: `src/app/gateway/[siteId]/session/session-client.tsx`

**Interfaces:**
- Consumes: `getWatchStatus` (Task 5); `requireUser`.
- Produces: `GET /api/gateway/:siteId/watch-status` → `{watching, controlHeld}`; a banner in the vendor `GatewaySession`.

> No unit test (auth route + client polling). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Implement the watch-status route**

Create `src/app/api/gateway/[siteId]/watch-status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getWatchStatus } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await requireUser();
  const { siteId } = await params;
  const status = await getWatchStatus(user.id, siteId);
  return NextResponse.json(status);
}
```

- [ ] **Step 2: Add the poll + banner to the vendor session client**

In `src/app/gateway/[siteId]/session/session-client.tsx`:

Add two state hooks at the top of `GatewaySession` (beside the existing `error` state):

```tsx
  const [watching, setWatching] = useState(false);
  const [controlHeld, setControlHeld] = useState(false);
```

Add a polling effect (new `useEffect`, separate from the guac effect):

```tsx
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/gateway/${siteId}/watch-status`, { cache: "no-store" });
        if (res.ok) {
          const s = (await res.json()) as { watching: boolean; controlHeld: boolean };
          if (!stop) {
            setWatching(s.watching);
            setControlHeld(s.controlHeld);
          }
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [siteId]);
```

Render the banner inside the returned root `<div>`, above the `{error && ...}` block:

```tsx
      {(watching || controlHeld) && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 20,
            background: controlHeld ? "rgba(180,0,0,0.9)" : "rgba(0,0,0,0.75)",
            color: "#fff", textAlign: "center", padding: "8px", fontFamily: "sans-serif", fontSize: "14px",
          }}
        >
          {controlHeld ? "An administrator has taken control of this session." : "This session is being monitored live."}
        </div>
      )}
```

(Ensure `useState`/`useEffect` are imported — they already are in this file.)

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/gateway/[siteId]/watch-status/route.ts" "src/app/gateway/[siteId]/session/session-client.tsx"
git commit -m "feat(gateway): vendor live-monitor banner + watch-status endpoint"
```

- [ ] **Step 5: Gate A — live validation (operator, after deploy)**

Manual acceptance, after deploy (bump `access-dataplane` + `access-manager`; set `DATAPLANE_INTERNAL_URL`; ensure nginx proxies `/guac-view`). Confirm:

1. A vendor runs an RDP gateway session. An admin opens `/admin/live` → the session is listed (user, site, `RDP` badge, started time). Click **Watch** → `/live/<id>` shows the vendor's screen updating live (it fills in as the vendor works; a static screen may be briefly blank). Admin mouse/keyboard do nothing (read-only). The vendor sees the "This session is being monitored live." banner within ~2 s.
2. Admin clicks **Take control** → the vendor's input stops and the vendor sees "An administrator has taken control of this session."; the admin's mouse/keyboard now drive the session. **Release control** → the vendor regains input and the banner reverts to the monitor notice. `/admin/audit` shows the watch + take + release events.
3. An **auditor** can open `/admin/live` and Watch, but has no **Take control** button. A **STAFF/VENDOR** user gets `notFound()` on `/admin/live` and `/live/[id]`.
4. When the vendor disconnects, the session drops off `/admin/live` and any open viewer shows "The session ended or is no longer available."

---

## Self-Review

**1. Spec coverage:**
- Active-session hub (no buffer, viewers, control) → Task 1. ✓
- Register + tee broadcast + vendor input gate → Task 2. ✓
- Viewer endpoint + internal API (`/sessions`, `/sessions/control`, `/sessions/watch-status`) + `ViewAuthz` → Task 3. ✓
- Manager `view-authz` (read_console) → Task 4. ✓
- Manager data-plane client (`DATAPLANE_INTERNAL_URL`) → Task 5. ✓
- `/admin/live` list + nav → Task 6. ✓
- Viewer page + take/release control + audit → Task 7. ✓
- Vendor watch banner + watch-status → Task 8. ✓
- Roles (watch=read_console, control=configure) → Tasks 4, 6, 7. ✓
- Audit events (watch started on page open; control taken/released) → Tasks 7. `live.watch.stopped` is intentionally omitted (unreliable to fire on disconnect; low value) — noted here, not a gap. ✓
- No schema change / no migrate; deploy notes (nginx `/guac-view`, `DATAPLANE_INTERNAL_URL`) → Global Constraints + Task 8 Gate A. ✓

**2. Placeholder scan:** No TBD/TODO; each code step has real code. The three route/client tasks without unit tests state the justification (repo pattern: secret-gated DB routes and thin network wrappers are not unit-tested) rather than leaving it vague.

**3. Type consistency:**
- `SessionInfo` JSON tags (`sessionId/siteId/userId/protocol/host/startedAt/viewerCount/controlOwner`, Task 1) exactly match `ActiveSession` (Task 5) and the `/sessions` consumer (Task 6). ✓
- `serveGuacTunnel(ctrl, reg, hub, w, r)` (Task 2) matches the `main.go` call and Task 1's `SessionHub`. ✓
- `hub.Register(sessionID, siteID, userID, protocol, host, startedAt, guac)` (Task 1) matches the Task 2 call. ✓
- `ViewAuthz(userID) (bool, error)` (Task 3) pairs with the `view-authz` `{userId}→{allow}` route (Task 4). ✓
- `setSessionControl(sessionId, ownerUserId, action)` (Task 5) matches the control route (Task 7) and the data-plane `/sessions/control` body `{sessionId, ownerUserId, action}` (Task 3). ✓
- `getWatchStatus(userId, siteId)` (Task 5) matches `/sessions/watch-status?userId=&siteId=` (Task 3) and the vendor route (Task 8). ✓
- `appendAuditEvents` input shape (Tasks 7) matches the existing usage in `admin/recordings/[id]/route.ts`. ✓
