# Session Connect/Disconnect Audit Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit an audit event when a GATEWAY / ISOLATED / web-WS session connects and disconnects (with duration), so the audit log + activity stream show session lifecycle — closing the gap where gateway/isolated sessions were never audited.

**Architecture:** Reuse the data-plane's existing `AuditQueue` → `AuditEvent` path (the same one that already logs web `ws_open`/`ws_close`). Emit `session_open` on start and `session_close <dur>` on end from the guac tunnel, the kasm tunnel, and the web WS proxy (renaming its `ws_open`/`ws_close`). The manager's activity feed maps those reasons to distinct connect/disconnect lines. No new endpoint, no schema change.

**Tech Stack:** Go (data-plane), Next.js/TypeScript (manager).

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- No schema change — reuse `AuditEvent.reason`; duration is carried in the reason string.
- Do not change per-request web `access.allow` logging, recording, live watching, or the gateway/isolated data path beyond adding the two audit emits.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Data-plane — gateway session + web WS normalize + duration helper

**Files:**
- Modify: `dataplane/audit.go` (helper)
- Modify: `dataplane/guactunnel.go`
- Modify: `dataplane/wsproxy.go`

- [ ] **Step 1: `compactDur` helper**

In `dataplane/audit.go`, add (ensure `fmt` + `time` are imported):

```go
// compactDur renders an elapsed duration for a session_close reason: "45s", "12m",
// "1h05m".
func compactDur(d time.Duration) string {
	s := int(d.Seconds())
	if s < 60 {
		return fmt.Sprintf("%ds", s)
	}
	m := s / 60
	if m < 60 {
		return fmt.Sprintf("%dm", m)
	}
	return fmt.Sprintf("%dh%02dm", m/60, m%60)
}
```

- [ ] **Step 2: Gateway tunnel emits open/close**

In `dataplane/guactunnel.go`, right after the hub registration block (`ls := hub.Register(...)`, `hub.SetCloser(...)`, `defer hub.Remove(sessionID)`), add:

```go
	sessStart := time.Now()
	audit.Enqueue(auditEvent("ALLOW", "session_open", userID, siteID, conn.Hostname, r, http.StatusSwitchingProtocols, 0))
	defer func() {
		audit.Enqueue(auditEvent("ALLOW", "session_close "+compactDur(time.Since(sessStart)), userID, siteID, conn.Hostname, r, http.StatusSwitchingProtocols, 0))
	}()
```

- [ ] **Step 3: Web WS proxy — normalize + duration**

In `dataplane/wsproxy.go`, capture the start and rename the two reasons. Before the `p.audit.Enqueue(auditEvent("ALLOW", "ws_open", …))` line add `wsStart := time.Now()`, change `"ws_open"` → `"session_open"`, and change the close line's `"ws_close"` → `"session_close "+compactDur(time.Since(wsStart))`:

```go
	wsStart := time.Now()
	p.audit.Enqueue(auditEvent("ALLOW", "session_open", userID, siteID, host, r, http.StatusSwitchingProtocols, 0))
```

```go
	p.audit.Enqueue(auditEvent("ALLOW", "session_close "+compactDur(time.Since(wsStart)), userID, siteID, host, r, http.StatusSwitchingProtocols, total))
```

- [ ] **Step 4: Build + test**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: PASS. (If `wsproxy_test.go` asserts on `"ws_open"`/`"ws_close"`, update those assertions to `"session_open"`/`"session_close"` — the close one now has a trailing duration, so assert a prefix.)

- [ ] **Step 5: Commit**

```bash
git add dataplane/audit.go dataplane/guactunnel.go dataplane/wsproxy.go
git commit -m "feat(dataplane): audit session open/close for gateway + web WS sessions"
```

---

### Task 2: Data-plane — isolated tunnel emits open/close

**Files:**
- Modify: `dataplane/kasmtunnel.go`
- Modify: `dataplane/main.go`

**Interfaces:**
- Produces: `serveKasmTunnel(ctrl, reg, hub, audit *AuditQueue, w, r)`.

- [ ] **Step 1: Add the audit param**

In `dataplane/kasmtunnel.go`, change the signature:

```go
func serveKasmTunnel(ctrl *ControlClient, reg *Registry, hub *SessionHub, audit *AuditQueue, w http.ResponseWriter, r *http.Request) {
```

- [ ] **Step 2: Emit open/close in the WS session block**

Inside the WebSocket block, right after `hub.RegisterIsolated(...)` + `hub.SetCloser(...)` + `defer hub.Remove(sessionID)` (Slice-1 registration), add:

```go
		kStart := time.Now()
		audit.Enqueue(auditEvent("ALLOW", "session_open", userID, siteID, d.NavigateUrl, r, http.StatusSwitchingProtocols, 0))
		defer func() {
			audit.Enqueue(auditEvent("ALLOW", "session_close "+compactDur(time.Since(kStart)), userID, siteID, d.NavigateUrl, r, http.StatusSwitchingProtocols, 0))
		}()
```

- [ ] **Step 3: Pass audit at the call sites**

In `dataplane/main.go`, both `serveKasmTunnel(ctrl, reg, hub, w, r)` calls become `serveKasmTunnel(ctrl, reg, hub, audit, w, r)`.

- [ ] **Step 4: Build + test**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dataplane/kasmtunnel.go dataplane/main.go
git commit -m "feat(dataplane): audit session open/close for isolated sessions"
```

---

### Task 3: Manager — activity feed shows connect/disconnect

**Files:**
- Modify: `src/lib/console/activity-feed.ts`

- [ ] **Step 1: Select reason + map session events**

In `src/lib/console/activity-feed.ts`, add `reason: true` to the `auditEvent.findMany` select. Replace the `accessItems` map with one that branches on the reason:

```ts
  const accessItems: ActivityItem[] = access.map((e) => {
    const reason = e.reason ?? "";
    const who = e.userEmail ?? "someone";
    const where = e.siteName ?? e.host;
    if (reason.startsWith("session_open")) {
      return { id: `a:${e.id}`, at: e.timestamp, kind: "session.connect", text: `${who} connected to ${where}`, tone: "ok" };
    }
    if (reason.startsWith("session_close")) {
      const dur = reason.slice("session_close".length).trim();
      return { id: `a:${e.id}`, at: e.timestamp, kind: "session.disconnect", text: `${who} disconnected from ${where}${dur ? ` · ${dur}` : ""}`, tone: "muted" };
    }
    return {
      id: `a:${e.id}`,
      at: e.timestamp,
      kind: e.decision === "ALLOW" ? "access.allow" : "access.deny",
      text: `${who} ${e.decision === "ALLOW" ? "accessed" : "blocked at"} ${where}`,
      tone: e.decision === "ALLOW" ? "ok" : "deny",
    };
  });
```

- [ ] **Step 2: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add src/lib/console/activity-feed.ts
git commit -m "feat(console): show session connect/disconnect (with duration) in the activity stream"
```

---

### Task 4: Full verification

**Files:** none.

- [ ] **Step 1: All builds green**

Run: `cd dataplane && go build ./... && go test ./... && cd .. && pnpm build`
Expected: all PASS.

- [ ] **Step 2: Wiring grep**

Run: `grep -rn "session_open\|session_close" dataplane/guactunnel.go dataplane/kasmtunnel.go dataplane/wsproxy.go && grep -rn "serveKasmTunnel(ctrl, reg, hub, audit" dataplane/main.go && grep -rn "session.connect\|session.disconnect" src/lib/console/activity-feed.ts`
Expected: matches in each; no stale `"ws_open"`/`"ws_close"` remain in wsproxy.

Run: `grep -rn '"ws_open"\|"ws_close"' dataplane/wsproxy.go`
Expected: no match.

- [ ] **Step 3: Manual Gate (record for deploy gate)**

Deferred to deploy (gateway host pulls the new dataplane image):
- Connect a GATEWAY session → the audit stream + `/admin/audit` show "<user> connected to <resource>"; disconnect → "<user> disconnected from <resource> · Xm".
- Same for an ISOLATED session and a web-app WebSocket session (e.g. a Proxmox console).
- Per-request web `access.allow` still logged as before; recording/live watching unchanged.

---

## Self-Review

**Spec coverage:**
- Gateway session open/close audit → Task 1. ✓
- Web WS normalized to session_open/close + duration → Task 1. ✓
- Isolated session open/close audit (+ audit param + main.go) → Task 2. ✓
- Activity feed maps reason → distinct connect/disconnect + duration → Task 3. ✓
- No schema change (duration in reason); per-request access.allow untouched → per design. ✓

**Placeholder scan:** none — concrete code; Task 1 Step 4 notes the wsproxy test-assertion caveat.

**Type/name consistency:** reason strings `session_open` / `session_close <dur>` produced in guactunnel/kasmtunnel/wsproxy (Tasks 1–2) and parsed in the feed (Task 3). `compactDur(time.Duration) string` defined once (Task 1) + used in all three emit sites. `serveKasmTunnel(…, audit *AuditQueue, …)` signature matches its two call sites (Task 2). `auditEvent(decision, reason, userID, siteID, host, r, status, bytes)` used with the existing signature everywhere.
