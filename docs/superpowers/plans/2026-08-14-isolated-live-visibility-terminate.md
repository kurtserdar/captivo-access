# Isolated Live Monitoring — Slice 1: Visibility + Terminate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register ISOLATED (KasmVNC) sessions in the data-plane SessionHub so they show in the console Live surfaces and can be force-terminated, closing the gap where isolated sessions are invisible and un-terminable.

**Architecture:** Add a `kind` discriminator to the hub; `serveKasmTunnel` registers its per-session browser as `kind="isolated"` with a terminate closer that closes the relay conn (unwinding the existing broker-close cleanup); the manager Live surfaces (console cards + `/admin/live` table) render isolated sessions with a Terminate action. No watch/take-control (Slice 2).

**Tech Stack:** Go (data-plane, package main), Next.js/TypeScript (manager), no schema change.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not change the GATEWAY guac path, transparent browserproxy, or isolated connect/recording behaviour — only ADD hub registration around the existing kasm proxy.
- No "Watch live"/Take-control for isolated in this slice (guard those by `kind === "gateway"`).
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Hub — `kind` discriminator + `RegisterIsolated`

**Files:**
- Modify: `dataplane/sessionhub.go`
- Test: `dataplane/sessionhub_test.go` (append)

**Interfaces:**
- Produces: `SessionInfo.Kind string` (json `kind`); `(*SessionHub).RegisterIsolated(sessionID, siteID, userID, host string, startedAt time.Time, connectorID string) *liveSession` (sets `kind="isolated"`, `protocol="isolated"`). Existing `Register(...)` now sets `kind="gateway"`.

- [ ] **Step 1: Write the failing test**

Append to `dataplane/sessionhub_test.go`:

```go
func TestRegisterIsolatedKindAndTerminate(t *testing.T) {
	h := NewSessionHub()
	h.RegisterIsolated("s1", "site1", "user1", "https://example.com", time.Now(), "conn1")
	list := h.List()
	if len(list) != 1 || list[0].Kind != "isolated" || list[0].Protocol != "isolated" {
		t.Fatalf("expected one isolated session with kind/protocol=isolated, got %+v", list)
	}
	called := false
	h.SetCloser("s1", func() { called = true })
	if !h.Terminate("s1") || !called {
		t.Fatalf("terminate did not invoke the closer")
	}
}
```

If `sessionhub_test.go` does not already import `"time"`, add it to that file's import block.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dataplane && go test ./... -run TestRegisterIsolatedKindAndTerminate`
Expected: FAIL — `RegisterIsolated` undefined / `Kind` undefined.

- [ ] **Step 3: Add `kind` to the structs**

In `dataplane/sessionhub.go`, add `Kind` to `SessionInfo` (after `UserID`):

```go
type SessionInfo struct {
	SessionID    string    `json:"sessionId"`
	SiteID       string    `json:"siteId"`
	UserID       string    `json:"userId"`
	Kind         string    `json:"kind"`
	Protocol     string    `json:"protocol"`
	Host         string    `json:"host"`
	StartedAt    time.Time `json:"startedAt"`
	ViewerCount  int       `json:"viewerCount"`
	ControlOwner string    `json:"controlOwner"`
}
```

Add `kind` to `liveSession` (extend the first field line):

```go
type liveSession struct {
	id, siteID, userID, protocol, host string
	kind                               string
	startedAt                          time.Time
	connID, connectorID, guacdAddr     string

	mu           sync.Mutex
	controlOwner string
	viewers      int
	closer       func()
}
```

- [ ] **Step 4: Set kind in Register + add RegisterIsolated + include in List**

In `Register(...)`, add `kind: "gateway",` to the `liveSession` literal.

Add the new constructor after `Register`:

```go
// RegisterIsolated adds an ISOLATED (KasmVNC) session. It has no guacd
// connID/guacdAddr — viewers attach to the per-session Xvnc instead (Slice 2) — so
// only the fields the console list + terminate need are set.
func (h *SessionHub) RegisterIsolated(sessionID, siteID, userID, host string, startedAt time.Time, connectorID string) *liveSession {
	ls := &liveSession{
		id: sessionID, siteID: siteID, userID: userID, protocol: "isolated", host: host,
		kind:      "isolated",
		startedAt: startedAt, connectorID: connectorID,
	}
	h.mu.Lock()
	h.m[sessionID] = ls
	h.mu.Unlock()
	return ls
}
```

In `List()`, add `Kind: ls.kind,` to the `SessionInfo` literal (after `UserID: ls.userID,`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd dataplane && go test ./... -run TestRegisterIsolatedKindAndTerminate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dataplane/sessionhub.go dataplane/sessionhub_test.go
git commit -m "feat(dataplane): add kind discriminator + RegisterIsolated to SessionHub"
```

---

### Task 2: kasmtunnel registers the isolated session + terminate closer

**Files:**
- Modify: `dataplane/kasmtunnel.go`
- Modify: `dataplane/main.go` (two `serveKasmTunnel` call sites)

**Interfaces:**
- Consumes: `RegisterIsolated`, `SetCloser`, `Remove`, `newSessionID()` (Task 1 + existing hub).
- Produces: `serveKasmTunnel(ctrl *ControlClient, reg *Registry, hub *SessionHub, w http.ResponseWriter, r *http.Request)`.

- [ ] **Step 1: Add `sync` and `time` imports**

In `dataplane/kasmtunnel.go`, add `"sync"` and `"time"` to the import block.

- [ ] **Step 2: Change the signature to take the hub**

```go
func serveKasmTunnel(ctrl *ControlClient, reg *Registry, hub *SessionHub, w http.ResponseWriter, r *http.Request) {
```

- [ ] **Step 3: Declare the captured-conn + sessionID before the proxy**

The reverse-proxy block near the end of `serveKasmTunnel` currently reads:

```go
	target, _ := url.Parse("http://" + backendAddr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return dialGuacd(sess, backendAddr) // relay to KasmVNC through the connector
		},
	}
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/kasm-tunnel")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}
	proxy.ServeHTTP(w, r)
}
```

Replace it with a version that captures the relay conn so the terminate closer can close it:

```go
	var connMu sync.Mutex
	var backendConn net.Conn
	target, _ := url.Parse("http://" + backendAddr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			c, e := dialGuacd(sess, backendAddr) // relay to KasmVNC through the connector
			if e == nil {
				connMu.Lock()
				backendConn = c
				connMu.Unlock()
			}
			return c, e
		},
	}
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/kasm-tunnel")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}
	proxy.ServeHTTP(w, r)
}
```

- [ ] **Step 4: Register the session in the WS block**

Inside the `if strings.EqualFold(r.Header.Get("Upgrade"), "websocket")` block, after the recording `if d.Record { ... }` section and its `defer` broker-close (right after the closing `}` of the `if d.Record` block, still inside the WS `if`), add the hub registration:

```go
		// Make this isolated session visible + terminable in the console. The closer
		// closes the captured relay conn, which ends proxy.ServeHTTP below and unwinds
		// the deferred broker close (killing Xvnc/Chromium) — terminate reuses the
		// normal teardown path. `backendConn`/`connMu` are declared just before the
		// proxy block; the conn is populated on the reverse proxy's first dial.
		sessionID := newSessionID()
		hub.RegisterIsolated(sessionID, siteID, userID, d.NavigateUrl, time.Now(), d.ConnectorID)
		hub.SetCloser(sessionID, func() {
			connMu.Lock()
			c := backendConn
			connMu.Unlock()
			if c != nil {
				_ = c.Close()
			}
		})
		defer hub.Remove(sessionID)
```

Note: `connMu`/`backendConn` are referenced here but declared in Step 3's block (later in the function). Move the two declarations (`var connMu sync.Mutex` and `var backendConn net.Conn`) up to the top of `serveKasmTunnel` (just after the `ck, err := r.Cookie(...)` guards, before `siteID := ...`) so they are in scope for both this registration and the proxy block. Remove them from the Step 3 snippet (keep only the `DialContext` capture there).

- [ ] **Step 5: Wire the hub in main.go**

In `dataplane/main.go`, update both call sites:

```go
	mux.HandleFunc("/kasm-tunnel", func(w http.ResponseWriter, r *http.Request) { serveKasmTunnel(ctrl, reg, hub, w, r) })
	mux.HandleFunc("/kasm-tunnel/", func(w http.ResponseWriter, r *http.Request) { serveKasmTunnel(ctrl, reg, hub, w, r) })
```

- [ ] **Step 6: Build + test**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: build + all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add dataplane/kasmtunnel.go dataplane/main.go
git commit -m "feat(dataplane): register isolated sessions in hub with terminate closer"
```

---

### Task 3: Manager — carry `kind`, split the console Live union, isolated card

**Files:**
- Modify: `src/lib/dataplane/client.ts`
- Modify: `src/lib/console/data.ts`
- Modify: `src/app/(app)/_console/security-console.tsx`

**Interfaces:**
- Consumes: `SessionInfo.kind` over `/sessions` (Tasks 1–2).
- Produces: `ActiveSession.kind`; `LiveCard` gains an `isolated` variant.

- [ ] **Step 1: Add `kind` to ActiveSession**

In `src/lib/dataplane/client.ts`, add to the `ActiveSession` interface (after `userId`):

```ts
  kind: "gateway" | "isolated";
```

- [ ] **Step 2: Add the isolated variant + split the mapping**

In `src/lib/console/data.ts`, add to the `LiveCard` union (after the gateway line):

```ts
  | { kind: "isolated"; sessionId: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number }
```

Replace the `gatewayCards` mapping with a kind-filtered gateway map plus an isolated map:

```ts
  const gatewayCards: LiveCard[] = sessions.filter((s) => s.kind !== "isolated").map((s) => ({
    kind: "gateway" as const,
    sessionId: s.sessionId, protocol: s.protocol, host: s.host,
    userLabel: userMap.get(s.userId) ?? "unknown", startedAt: s.startedAt,
    recorded: recEnabled && (recMap.get(s.siteId) ?? false), viewerCount: s.viewerCount,
  }));
  const isolatedCards: LiveCard[] = sessions.filter((s) => s.kind === "isolated").map((s) => ({
    kind: "isolated" as const,
    sessionId: s.sessionId, host: s.host,
    userLabel: userMap.get(s.userId) ?? "unknown", startedAt: s.startedAt,
    recorded: recEnabled && (recMap.get(s.siteId) ?? false), viewerCount: s.viewerCount,
  }));
```

Update the `live` array to include isolated:

```ts
  const live: LiveCard[] = [...gatewayCards, ...isolatedCards, ...webCards];
```

(The live KPI stays `sessions.length + webSessions.length` — isolated is already in `sessions`.)

- [ ] **Step 3: Render the isolated card**

In `src/app/(app)/_console/security-console.tsx`, the `live.map(...)` currently branches `s.kind === "gateway" ? (gateway) : (web)`. Insert an isolated branch between them, so it reads `... ? (gateway) : s.kind === "isolated" ? (isolated) : (web)`:

```tsx
              ) : s.kind === "isolated" ? (
                <div key={s.sessionId} className="sc-card">
                  <div className="sc-card-top">
                    <span className="sc-chip">ISOLATED</span>
                    {s.recorded && <span className="sc-rec"><span className="sc-dot" />REC {duration(s.startedAt, now)}</span>}
                  </div>
                  <div className="sc-card-name">{s.host}</div>
                  <div className="sc-card-sub">{s.userLabel}</div>
                  <div className="sc-thumb">isolated browser</div>
                  <div className="sc-card-actions">
                    <TerminateButton sessionId={s.sessionId} className="btn sm danger" />
                  </div>
                </div>
              ) : (
```

(`duration` and `TerminateButton` are already imported in this file.)

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: success (union + card typecheck).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dataplane/client.ts src/lib/console/data.ts "src/app/(app)/_console/security-console.tsx"
git commit -m "feat(console): isolated live cards with terminate"
```

---

### Task 4: `/admin/live` table — isolated rows

**Files:**
- Modify: `src/app/(app)/admin/live/live-table.tsx`
- Modify: `src/app/(app)/admin/live/page.tsx`

**Interfaces:**
- Consumes: `ActiveSession.kind` (Task 3).
- Produces: `LiveRow` gains an `isolated` variant.

- [ ] **Step 1: Add the isolated LiveRow variant**

In `src/app/(app)/admin/live/live-table.tsx`, add to the `LiveRow` union (after the gateway line):

```ts
  | { kind: "isolated"; sessionId: string; siteName: string; userLabel: string; host: string; startedAt: string }
```

- [ ] **Step 2: Render the isolated row**

In the `filtered.map(...)`, which branches `r.kind === "gateway" ? (gateway row) : (web row)`, insert an isolated branch between them (`... ? (gateway) : r.kind === "isolated" ? (isolated) : (web)`):

```tsx
            ) : r.kind === "isolated" ? (
              <tr key={r.sessionId}>
                <td>{r.userLabel}</td>
                <td>{r.siteName}</td>
                <td><span className="pill">ISOLATED</span></td>
                <td className="cell-sub"><LocalTime iso={r.startedAt} /></td>
                <td className="cell-sub">—</td>
                <td className="row-actions">
                  {canTerminate && <TerminateButton sessionId={r.sessionId} className="btn sm danger" />}
                </td>
              </tr>
            ) : (
```

The existing `textMatch([r.userLabel, r.siteName, r.kind === "gateway" ? r.protocol : r.host], q)` already handles isolated via the `r.host` branch — no change needed.

- [ ] **Step 3: Build isolated rows in the page**

In `src/app/(app)/admin/live/page.tsx`, filter the gateway map by kind and add an isolated map:

```ts
  const gatewayRows: LiveRow[] = sessions.filter((s) => s.kind !== "isolated").map((s) => ({
    kind: "gateway" as const,
    sessionId: s.sessionId,
    siteName: sites.get(s.siteId)?.name ?? s.host,
    userLabel: label(s.userId),
    protocol: s.protocol,
    startedAt: s.startedAt,
    viewerCount: s.viewerCount,
    controlled: s.controlOwner !== "",
  }));
  const isolatedRows: LiveRow[] = sessions.filter((s) => s.kind === "isolated").map((s) => ({
    kind: "isolated" as const,
    sessionId: s.sessionId,
    siteName: sites.get(s.siteId)?.name ?? s.host,
    userLabel: label(s.userId),
    host: s.host,
    startedAt: s.startedAt,
  }));
```

Update the `rows` line:

```ts
  const rows = [...gatewayRows, ...isolatedRows, ...webRows];
```

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/live/live-table.tsx" "src/app/(app)/admin/live/page.tsx"
git commit -m "feat(admin): isolated rows in the live sessions table"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Data-plane green**

Run: `cd dataplane && go build ./... && go test ./... && cd ..`
Expected: build + tests PASS (incl. `TestRegisterIsolatedKindAndTerminate`).

- [ ] **Step 2: Manager green**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 3: Wiring grep**

Run: `grep -rn "serveKasmTunnel(ctrl, reg, hub" dataplane/main.go`
Expected: two matches (`/kasm-tunnel` and `/kasm-tunnel/`).

Run: `grep -rn "kind === \"isolated\"" src/lib/console/data.ts "src/app/(app)/admin/live/page.tsx"`
Expected: matches in both (the console + admin table both split by kind).

- [ ] **Step 4: Manual Gate (record for deploy gate)**

Deferred to deploy (separate approval):
- Start an isolated session → it appears as an ISOLATED card in the console Live section and as an ISOLATED row in `/admin/live`.
- Click Terminate → the vendor's isolated browser ends; the card/row disappears on the next poll.
- GATEWAY watch/terminate and Web cards unchanged.

---

## Self-Review

**Spec coverage:**
- Hub `kind` + `RegisterIsolated` + `SessionInfo.Kind` → Task 1. ✓
- kasmtunnel register + terminate closer (capture relay conn) + main.go wiring → Task 2. ✓
- `ActiveSession.kind` + console union split + isolated card (no Watch) → Task 3. ✓
- `/admin/live` isolated rows (Terminate, no Watch/Control) → Task 4. ✓
- Terminate reuses existing `/sessions/terminate` → hub.Terminate → closer → verified in Task 1 test + Task 5 manual gate. ✓
- No schema change; manager + dataplane images → deploy notes. ✓
- Watch/take-control excluded (Slice 2). ✓

**Placeholder scan:** none — every step carries concrete code.

**Type consistency:** `kind` values `"gateway"`/`"isolated"` used consistently in Go (`liveSession.kind`, `SessionInfo.Kind`) and TS (`ActiveSession.kind`, `LiveCard`, `LiveRow`). `RegisterIsolated` signature identical in Task 1 (definition), Task 1 test, and Task 2 (call). Isolated card/row fields (`sessionId`, `host`, `siteName`, `userLabel`, `startedAt`, `recorded`, `viewerCount`) match their union declarations.
