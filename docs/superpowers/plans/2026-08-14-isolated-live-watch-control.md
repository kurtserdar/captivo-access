# Isolated Live Monitoring — Slice 2: Watch + Take-Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin watch an ISOLATED (KasmVNC) session live (read-only) and take cooperative control, reaching parity with GATEWAY sessions.

**Architecture:** Watch = a second shared KasmVNC client to the same per-session Xvnc (kept safe by Xvnc `-AlwaysShared=1`). A new data-plane `/kasm-view` relay attaches to an existing hub session (non-WS→hub assets, WS→the vendor's session port). The manager's `/live/[id]` page renders a `KasmLiveViewer` iframe for isolated sessions; read-only vs control is the client-side `view_only` KasmVNC setting, gated by the existing `controlOwner`/`/sessions/control` path. Terminate + the hub are reused from Slice 1.

**Tech Stack:** Go (data-plane, package main), Python broker, Next.js/TypeScript, Caddy/nginx front proxy. No schema change.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not break the GATEWAY guac path, transparent browserproxy, or the vendor's isolated connect/recording/terminate behaviour (only add `-AlwaysShared` + attach info + a new viewer relay).
- Read-only is client-side `view_only` (cooperative; admin is trusted). No server-side RFB filtering.
- `/kasm-view` must be routed in the shipped `deploy/Caddyfile`; the prod host nginx route is an out-of-band deploy step.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: kasm image — `-AlwaysShared=1`

**Files:**
- Modify: `kasm-browser/control.py` (`_spawn`, Xvnc launch)

**Interfaces:**
- Produces: per-session Xvnc that never disconnects the vendor when a second (admin) client attaches. Independent of later tasks.

- [ ] **Step 1: Add the flag to the Xvnc launch**

In `kasm-browser/control.py`, the `_spawn(...)` `Xvnc` Popen currently ends `"-disableBasicAuth", send_cut, accept_cut], env=env)`. Add `-AlwaysShared=1` so a second viewer shares the display instead of dropping the vendor:

```python
    xvnc = subprocess.Popen(
        ["Xvnc", disp, "-geometry", "1280x800", "-depth", "24",
         "-websocketPort", str(port), "-interface", "0.0.0.0",
         "-httpd", "/usr/share/kasmvnc/www", "-SecurityTypes", "None",
         "-disableBasicAuth", "-AlwaysShared=1", send_cut, accept_cut], env=env)
```

- [ ] **Step 2: Verify Python parses**

Run: `python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add kasm-browser/control.py
git commit -m "feat(isolated): Xvnc -AlwaysShared so a live viewer never drops the vendor"
```

---

### Task 2: Hub — store kasm attach info + `kasmAttach()`

**Files:**
- Modify: `dataplane/sessionhub.go`
- Modify: `dataplane/sessionhub_test.go`
- Modify: `dataplane/kasmtunnel.go` (the `RegisterIsolated` call)

**Interfaces:**
- Produces: `RegisterIsolated(sessionID, siteID, userID, host string, startedAt time.Time, connectorID, kasmAddr string, kasmPort int) *liveSession`; `(*liveSession).kasmAttach() (connectorID, kasmAddr string, kasmPort int)`.

- [ ] **Step 1: Update the failing test**

In `dataplane/sessionhub_test.go`, change `TestRegisterIsolatedKindAndTerminate` to pass the new args and assert `kasmAttach`:

```go
func TestRegisterIsolatedKindAndTerminate(t *testing.T) {
	h := NewSessionHub()
	ls := h.RegisterIsolated("s1", "site1", "user1", "https://example.com", time.Now(), "conn1", "10.0.0.1:6901", 6902)
	list := h.List()
	if len(list) != 1 || list[0].Kind != "isolated" || list[0].Protocol != "isolated" {
		t.Fatalf("expected one isolated session with kind/protocol=isolated, got %+v", list)
	}
	if cid, addr, port := ls.kasmAttach(); cid != "conn1" || addr != "10.0.0.1:6901" || port != 6902 {
		t.Fatalf("kasmAttach mismatch: %s %s %d", cid, addr, port)
	}
	called := false
	h.SetCloser("s1", func() { called = true })
	if !h.Terminate("s1") || !called {
		t.Fatalf("terminate did not invoke the closer")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dataplane && go test ./... -run TestRegisterIsolatedKindAndTerminate`
Expected: FAIL — `RegisterIsolated` arg count / `kasmAttach` undefined.

- [ ] **Step 3: Add fields + accessor + extend RegisterIsolated**

In `dataplane/sessionhub.go`, add the two fields to `liveSession` (after `connID, connectorID, guacdAddr string`):

```go
	kasmAddr string
	kasmPort int
```

Add the accessor near `shareInfo`:

```go
func (ls *liveSession) kasmAttach() (string, string, int) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.connectorID, ls.kasmAddr, ls.kasmPort
}
```

Extend `RegisterIsolated`:

```go
func (h *SessionHub) RegisterIsolated(sessionID, siteID, userID, host string, startedAt time.Time, connectorID, kasmAddr string, kasmPort int) *liveSession {
	ls := &liveSession{
		id: sessionID, siteID: siteID, userID: userID, protocol: "isolated", host: host,
		kind:      "isolated",
		startedAt: startedAt, connectorID: connectorID, kasmAddr: kasmAddr, kasmPort: kasmPort,
	}
	h.mu.Lock()
	h.m[sessionID] = ls
	h.mu.Unlock()
	return ls
}
```

- [ ] **Step 4: Pass attach info from kasmtunnel**

In `dataplane/kasmtunnel.go`, update the `RegisterIsolated` call to pass the hub addr + per-session port:

```go
		hub.RegisterIsolated(sessionID, siteID, userID, d.NavigateUrl, time.Now(), d.ConnectorID, d.KasmAddr, port)
```

- [ ] **Step 5: Build + test**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: build + tests PASS.

- [ ] **Step 6: Commit**

```bash
git add dataplane/sessionhub.go dataplane/sessionhub_test.go dataplane/kasmtunnel.go
git commit -m "feat(dataplane): store kasm attach info on isolated sessions"
```

---

### Task 3: Data-plane `/kasm-view` relay

**Files:**
- Create: `dataplane/kasmview.go`
- Modify: `dataplane/main.go` (routes)

**Interfaces:**
- Consumes: `ctrl.ResolveSession`, `ctrl.ViewAuthz`, `hub.Get`, `kasmAttach()`, `reg.Get`, `dialGuacd`, `kasmSessionAddr` (all existing).
- Produces: `serveKasmView(hub *SessionHub, ctrl *ControlClient, reg *Registry, w http.ResponseWriter, r *http.Request)`.

- [ ] **Step 1: Write the relay**

Create `dataplane/kasmview.go`:

```go
package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// serveKasmView attaches an admin viewer to an active ISOLATED (KasmVNC) session by
// opening a SECOND shared client to the same per-session Xvnc (the vendor stays
// connected thanks to Xvnc -AlwaysShared). Read-only vs control is the client-side
// view_only setting on the KasmVNC web client — this relay is identical either way.
// It mirrors the vendor tunnel's reverse-proxy shape but attaches to an existing hub
// session instead of opening a new one.
func serveKasmView(hub *SessionHub, ctrl *ControlClient, reg *Registry, w http.ResponseWriter, r *http.Request) {
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
	if allow, e := ctrl.ViewAuthz(viewerUserID); e != nil || !allow {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// The KasmVNC client's follow-up asset/WS requests carry no ?session, so pin it
	// in a cookie the way the vendor tunnel pins ca_kasm_site.
	sessionID := r.URL.Query().Get("session")
	if sessionID == "" {
		if c, e := r.Cookie("ca_kasm_view"); e == nil {
			sessionID = c.Value
		}
	}
	if r.URL.Query().Get("session") != "" {
		http.SetCookie(w, &http.Cookie{Name: "ca_kasm_view", Value: sessionID, Path: "/kasm-view", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	}

	ls := hub.Get(sessionID)
	if ls == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	connectorID, kasmAddr, kasmPort := ls.kasmAttach()
	if kasmAddr == "" {
		http.Error(w, "not an isolated session", http.StatusConflict)
		return
	}
	sess := reg.Get(connectorID)
	if sess == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}

	backendAddr := kasmAddr // static web client from the always-on hub
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		backendAddr = kasmSessionAddr(kasmAddr, kasmPort) // live RFB on the vendor's display
		ls.addViewer()
		defer ls.removeViewer()
	}
	target, _ := url.Parse("http://" + backendAddr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return dialGuacd(sess, backendAddr) // relay through the connector
		},
	}
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/kasm-view")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}
	proxy.ServeHTTP(w, r)
}
```

- [ ] **Step 2: Register the routes**

In `dataplane/main.go`, after the `/guac-view` registration, add:

```go
	mux.HandleFunc("/kasm-view", func(w http.ResponseWriter, r *http.Request) { serveKasmView(hub, ctrl, reg, w, r) })
	mux.HandleFunc("/kasm-view/", func(w http.ResponseWriter, r *http.Request) { serveKasmView(hub, ctrl, reg, w, r) })
```

- [ ] **Step 3: Build + test**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dataplane/kasmview.go dataplane/main.go
git commit -m "feat(dataplane): /kasm-view relay to watch/control isolated sessions"
```

---

### Task 4: Manager — kind-aware live viewer + Watch links

**Files:**
- Create: `src/app/live/[sessionId]/kasm-live-viewer.tsx`
- Modify: `src/app/live/[sessionId]/page.tsx`
- Modify: `src/app/(app)/_console/security-console.tsx`
- Modify: `src/app/(app)/admin/live/live-table.tsx`
- Modify: `src/app/(app)/admin/live/page.tsx`

**Interfaces:**
- Consumes: `/kasm-view` (Task 3), `/api/admin/live/[id]/control` (existing), `ActiveSession.kind` + `viewerCount` (Slice 1).
- Produces: `KasmLiveViewer({ sessionId, canControl })`.

- [ ] **Step 1: Write the KasmLiveViewer**

Create `src/app/live/[sessionId]/kasm-live-viewer.tsx`:

```tsx
"use client";
import { useState } from "react";

// Admin viewer for an ISOLATED (KasmVNC) session: a second shared client to the same
// Xvnc via /kasm-view. Read-only vs control is the client-side view_only setting;
// toggling control reconnects the iframe (via the src key) in the new mode after the
// server records controlOwner.
export function KasmLiveViewer({ sessionId, canControl }: { sessionId: string; canControl: boolean }) {
  const [controlling, setControlling] = useState(false);
  const [busy, setBusy] = useState(false);
  const viewOnly = !controlling;
  const src = `/kasm-view/?session=${encodeURIComponent(sessionId)}&path=kasm-view/websockify&view_only=${viewOnly}`;

  async function toggleControl() {
    setBusy(true);
    const action = controlling ? "release" : "take";
    try {
      const res = await fetch(`/api/admin/live/${sessionId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // 200 => granted/released; 409 => control held by another admin (stay read-only).
      if (res.ok) setControlling(action === "take");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      <iframe key={src} title="Live session" src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} allow="clipboard-read; clipboard-write" />
      <div className="live-badge">● LIVE{controlling ? " · CONTROLLING" : ""}</div>
      {canControl && (
        <button type="button" className="btn sm live-control" disabled={busy} onClick={toggleControl}>
          {controlling ? "Release control" : "Take control"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Make the /live page kind-aware**

In `src/app/live/[sessionId]/page.tsx`, add imports:

```tsx
import { LiveViewer } from "./live-viewer";
import { KasmLiveViewer } from "./kasm-live-viewer";
import { listActiveSessions } from "@/lib/dataplane/client";
```

Replace the final `return <LiveViewer sessionId={sessionId} canControl={can(user.role, "configure")} />;` with:

```tsx
  const sessions = await listActiveSessions();
  const isolated = sessions.find((s) => s.sessionId === sessionId)?.kind === "isolated";
  const canControl = can(user.role, "configure");
  return isolated
    ? <KasmLiveViewer sessionId={sessionId} canControl={canControl} />
    : <LiveViewer sessionId={sessionId} canControl={canControl} />;
```

- [ ] **Step 3: Restore Watch + viewer count on the console isolated card**

In `src/app/(app)/_console/security-console.tsx`, in the `s.kind === "isolated"` card, change the sub line to include the watcher count and add the Watch link:

```tsx
                  <div className="sc-card-name">{s.host}</div>
                  <div className="sc-card-sub">{s.userLabel}{s.viewerCount > 0 ? ` · ${s.viewerCount} watching` : ""}</div>
                  <div className="sc-thumb">isolated browser</div>
                  <div className="sc-card-actions">
                    <Link href={`/live/${s.sessionId}`} className="sc-watch">Watch live</Link>
                    <TerminateButton sessionId={s.sessionId} className="btn sm danger" />
                  </div>
```

(`Link` is already imported in this file.)

- [ ] **Step 4: Watch + viewer count on the admin table isolated row**

In `src/app/(app)/admin/live/live-table.tsx`, add `viewerCount` to the isolated `LiveRow` variant:

```ts
  | { kind: "isolated"; sessionId: string; siteName: string; userLabel: string; host: string; startedAt: string; viewerCount: number }
```

Change the isolated row's Watchers cell + actions:

```tsx
                <td className="cell-sub">{r.viewerCount}</td>
                <td className="row-actions">
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <Link href={`/live/${r.sessionId}`} className="btn sm">Watch</Link>
                    {canTerminate && <TerminateButton sessionId={r.sessionId} className="btn sm danger" />}
                  </span>
                </td>
```

(`Link` is already imported in this file.)

- [ ] **Step 5: Populate viewerCount in the admin page mapping**

In `src/app/(app)/admin/live/page.tsx`, add `viewerCount: s.viewerCount,` to the `isolatedRows` map (after `startedAt: s.startedAt,`).

- [ ] **Step 6: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add "src/app/live/[sessionId]/kasm-live-viewer.tsx" "src/app/live/[sessionId]/page.tsx" "src/app/(app)/_console/security-console.tsx" "src/app/(app)/admin/live/live-table.tsx" "src/app/(app)/admin/live/page.tsx"
git commit -m "feat(console): watch + take-control for isolated live sessions"
```

---

### Task 5: Front proxy (Caddyfile) + verification

**Files:**
- Modify: `deploy/Caddyfile`

- [ ] **Step 1: Route /kasm-view in the shipped Caddyfile**

In `deploy/Caddyfile`, the `@guac` matcher currently reads:

```
	@guac path /guac-tunnel /guac-view /kasm-tunnel /kasm-tunnel/*
```

Add the view paths:

```
	@guac path /guac-tunnel /guac-view /kasm-tunnel /kasm-tunnel/* /kasm-view /kasm-view/*
```

- [ ] **Step 2: Data-plane green**

Run: `cd dataplane && go build ./... && go test ./... && cd ..`
Expected: PASS.

- [ ] **Step 3: Manager green**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 4: Wiring grep**

Run: `grep -rn "serveKasmView(hub, ctrl, reg" dataplane/main.go`
Expected: two matches.

Run: `grep -rn "kasm-view" deploy/Caddyfile "src/app/live/[sessionId]/kasm-live-viewer.tsx"`
Expected: matches in both.

- [ ] **Step 5: Commit**

```bash
git add deploy/Caddyfile
git commit -m "chore(deploy): route /kasm-view to the data-plane in the shipped Caddyfile"
```

- [ ] **Step 6: Manual Gate (record for deploy gate)**

Deferred to deploy (separate approval; also add the `/kasm-view` location to the prod host nginx out of band, mirroring `/kasm-tunnel`):
- Vendor starts an isolated session; admin clicks "Watch live" → sees the live screen read-only, vendor NOT disconnected, "1 watching" shown on the card.
- Admin "Take control" → can drive the isolated browser; vendor stays connected. "Release control" → back to read-only.
- Close the viewer → vendor session continues. Terminate still ends it.
- GATEWAY watch/control unchanged.

---

## Self-Review

**Spec coverage:**
- Xvnc `-AlwaysShared=1` → Task 1. ✓
- Hub kasm attach fields + `RegisterIsolated` extension + `kasmAttach()` → Task 2. ✓
- `serveKasmView` (authz + hub lookup + non-WS→hub / WS→port relay + viewer count) + routes → Task 3. ✓
- `/live` kind-aware + `KasmLiveViewer` (view_only + take/release via `/sessions/control`) → Task 4. ✓
- Restore Watch links + viewer count on console card + admin table → Task 4. ✓
- Caddyfile `/kasm-view` route → Task 5; host nginx = deploy note. ✓
- Client-side view_only enforcement; no schema change → per spec. ✓

**Placeholder scan:** none — every step carries concrete code.

**Type consistency:** `RegisterIsolated(... connectorID, kasmAddr string, kasmPort int)` identical in Task 2 definition, test, and Task 2 Step 4 call. `kasmAttach() (string, string, int)` used in Task 2 (def/test) and Task 3 (`connectorID, kasmAddr, kasmPort := ls.kasmAttach()`). `serveKasmView(hub, ctrl, reg, w, r)` signature matches its two call sites. `KasmLiveViewer({ sessionId, canControl })` matches its render in Task 4 Step 2. `viewerCount` added to the isolated `LiveRow` (Task 4 Step 4) and populated (Step 5).
