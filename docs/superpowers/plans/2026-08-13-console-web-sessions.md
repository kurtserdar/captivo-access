# Console Web-App Live Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show active web-app (transparent) access as live cards in the Security Console, alongside gateway sessions.

**Architecture:** A new in-memory `WebActivityTracker` in the data-plane records `(userId, siteId)` activity on each allowed web-app request and exposes it via an internal `/web-sessions` endpoint. The manager merges it with the gateway `SessionHub` list into one discriminated `LiveCard` union; web cards show a "Web app" badge, "active Xs ago", and a **Revoke access** action (reusing the grant-revoke endpoint).

**Tech Stack:** Go (data-plane), TypeScript/Next.js (manager), vitest.

## Global Constraints

- **English only** — code, comments, commit messages.
- **No Claude signature** in commits.
- **No schema change**, no migrate, no connector. Ships as **v0.44.0** (manager + dataplane).
- Idle window default **120s**, env `WEB_SESSION_IDLE_SECS` (data-plane), read via existing `envInt(key, default)` (2-arg).
- Internal endpoints are gated by `x-dataplane-secret` (mirror the existing `/sessions` handler exactly).
- Revoke reuses the existing `DELETE /api/admin/grants?id=<grantId>` (capability `approve_grants`) — no new route.
- Data-plane tests: `cd dataplane && go test ./...`. Manager: `pnpm test`, `pnpm build`.

---

### Task 1: Data-plane `WebActivityTracker`

**Files:**
- Create: `dataplane/webactivity.go`
- Test: `dataplane/webactivity_test.go`

**Interfaces:**
- Produces: `WebSessionInfo` struct; `NewWebActivityTracker() *WebActivityTracker`; `(*WebActivityTracker).Touch(userID, siteID, host string)`; `(*WebActivityTracker).List(idle time.Duration) []WebSessionInfo`.

- [ ] **Step 1: Write the failing test**

Create `dataplane/webactivity_test.go`:

```go
package main

import (
	"testing"
	"time"
)

func TestWebActivityTouchAndList(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "app.internal")
	got := tr.List(120 * time.Second)
	if len(got) != 1 || got[0].UserID != "u1" || got[0].SiteID != "s1" || got[0].Host != "app.internal" {
		t.Fatalf("unexpected list: %+v", got)
	}
	if !got[0].StartedAt.Equal(base) || !got[0].LastSeen.Equal(base) {
		t.Fatalf("timestamps wrong: %+v", got[0])
	}
}

func TestWebActivityPrunesIdle(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h")
	// 121s later, the entry is beyond a 120s idle window.
	tr.now = func() time.Time { return base.Add(121 * time.Second) }
	if got := tr.List(120 * time.Second); len(got) != 0 {
		t.Fatalf("expected pruned, got %+v", got)
	}
}

func TestWebActivityKeepsStartedAtAcrossTouches(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h")
	tr.now = func() time.Time { return base.Add(30 * time.Second) }
	tr.Touch("u1", "s1", "h2") // within window → same span, host updates, StartedAt kept
	got := tr.List(120 * time.Second)
	if len(got) != 1 || !got[0].StartedAt.Equal(base) || !got[0].LastSeen.Equal(base.Add(30*time.Second)) || got[0].Host != "h2" {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestWebActivityGapStartsNewSpan(t *testing.T) {
	tr := NewWebActivityTracker()
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return base }
	tr.Touch("u1", "s1", "h")
	// A gap longer than the window prunes, then a later Touch is a fresh span.
	tr.now = func() time.Time { return base.Add(200 * time.Second) }
	tr.List(120 * time.Second) // prunes the stale entry
	tr.Touch("u1", "s1", "h")
	got := tr.List(120 * time.Second)
	if len(got) != 1 || !got[0].StartedAt.Equal(base.Add(200*time.Second)) {
		t.Fatalf("expected new span, got %+v", got)
	}
}

func TestWebActivityDistinctPairs(t *testing.T) {
	tr := NewWebActivityTracker()
	tr.now = func() time.Time { return time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) }
	tr.Touch("u1", "s1", "h")
	tr.Touch("u1", "s2", "h")
	tr.Touch("u2", "s1", "h")
	if got := tr.List(120 * time.Second); len(got) != 3 {
		t.Fatalf("expected 3 distinct, got %d", len(got))
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dataplane && go test ./... -run TestWebActivity`
Expected: FAIL — `undefined: NewWebActivityTracker`.

- [ ] **Step 3: Write the implementation**

Create `dataplane/webactivity.go`:

```go
package main

import (
	"sort"
	"sync"
	"time"
)

// WebSessionInfo is the JSON snapshot of one active web-app (transparent) access
// span for the internal list API. Unlike a gateway session it is not a live
// connection — it is derived from recent proxied requests.
type WebSessionInfo struct {
	UserID    string    `json:"userId"`
	SiteID    string    `json:"siteId"`
	Host      string    `json:"host"`
	StartedAt time.Time `json:"startedAt"`
	LastSeen  time.Time `json:"lastSeen"`
}

// WebActivityTracker is a thread-safe, in-memory record of recent web-app access,
// keyed by (userId, siteId). It is the transparent-proxy analogue of SessionHub.
// In-memory only: lost on restart, like SessionHub.
type WebActivityTracker struct {
	mu  sync.Mutex
	m   map[string]*WebSessionInfo
	now func() time.Time
}

func NewWebActivityTracker() *WebActivityTracker {
	return &WebActivityTracker{m: map[string]*WebSessionInfo{}, now: time.Now}
}

const webKeySep = "\x1f"

// Touch records activity for (userID, siteID). Cheap and non-blocking. A first
// touch (or one after the entry was pruned) starts a new span; a touch within the
// window advances LastSeen and refreshes the host, keeping StartedAt.
func (t *WebActivityTracker) Touch(userID, siteID, host string) {
	if userID == "" || siteID == "" {
		return
	}
	now := t.now()
	key := userID + webKeySep + siteID
	t.mu.Lock()
	defer t.mu.Unlock()
	if e, ok := t.m[key]; ok {
		e.LastSeen = now
		e.Host = host
		return
	}
	t.m[key] = &WebSessionInfo{UserID: userID, SiteID: siteID, Host: host, StartedAt: now, LastSeen: now}
}

// List returns the active spans (LastSeen within idle), pruning older ones. The
// result is sorted by StartedAt descending (newest first) for stable display.
func (t *WebActivityTracker) List(idle time.Duration) []WebSessionInfo {
	cutoff := t.now().Add(-idle)
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]WebSessionInfo, 0, len(t.m))
	for key, e := range t.m {
		if e.LastSeen.Before(cutoff) {
			delete(t.m, key)
			continue
		}
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd dataplane && go test ./... -run TestWebActivity`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add dataplane/webactivity.go dataplane/webactivity_test.go
git commit -m "feat(dataplane): web-app activity tracker"
```

---

### Task 2: Wire the tracker into the proxy + internal endpoint

**Files:**
- Modify: `dataplane/browserproxy.go` (struct field + Touch at the ALLOW emit)
- Modify: `dataplane/main.go` (construct tracker, pass to proxy, `/web-sessions` endpoint)

**Interfaces:**
- Consumes: `NewWebActivityTracker`, `(*WebActivityTracker).Touch`, `(*WebActivityTracker).List` (Task 1); existing `envInt(key, default)`, `writeJSON`.

- [ ] **Step 1: Add the tracker field to BrowserProxy**

In `dataplane/browserproxy.go`, extend the struct:

```go
type BrowserProxy struct {
	reg        *Registry
	ctrl       proxyControl
	managerURL string
	audit      *AuditQueue
	web        *WebActivityTracker
}
```

- [ ] **Step 2: Touch on the allowed-HTTP emit**

In `dataplane/browserproxy.go`, at the ALLOW audit emit (the line
`p.audit.Enqueue(auditEvent("ALLOW", "", userID, siteID, host, r, resp.Status, written))`,
~line 386), add immediately after it:

```go
	p.web.Touch(userID, siteID, host)
```

(At this point `userID` is non-empty — anonymous requests were already redirected
to login — and `/__captivo/*` paths were intercepted earlier, so this only counts
real web-app responses.)

- [ ] **Step 3: Construct the tracker + pass it to the proxy**

In `dataplane/main.go`, where `proxy := &BrowserProxy{...}` is built (line ~257):

```go
	web := NewWebActivityTracker()
	proxy := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: managerURL, audit: audit, web: web}
```

- [ ] **Step 4: Add the internal `/web-sessions` endpoint**

In `dataplane/main.go`, next to the `in.HandleFunc("/sessions", …)` handler, add:

```go
	webIdle := time.Duration(envInt("WEB_SESSION_IDLE_SECS", 120)) * time.Second
	in.HandleFunc("/web-sessions", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		writeJSON(w, http.StatusOK, web.List(webIdle))
	})
```

(Ensure `time` is imported in main.go — it already is if other timers exist; if not, add it.)

- [ ] **Step 5: Verify it builds + existing tests pass**

Run: `cd dataplane && go build ./... && go vet ./... && go test ./...`
Expected: builds clean, all PASS.

- [ ] **Step 6: Commit**

```bash
git add dataplane/browserproxy.go dataplane/main.go
git commit -m "feat(dataplane): record web-app activity + /web-sessions endpoint"
```

---

### Task 3: Manager data-plane client

**Files:**
- Modify: `src/lib/dataplane/client.ts`

**Interfaces:**
- Produces: `WebSession` interface; `listActiveWebSessions(): Promise<WebSession[]>`.

- [ ] **Step 1: Add the interface + fetch**

In `src/lib/dataplane/client.ts`, after the `ActiveSession` interface + `listActiveSessions`, add:

```ts
export interface WebSession {
  userId: string;
  siteId: string;
  host: string;
  startedAt: string;
  lastSeen: string;
}

export async function listActiveWebSessions(): Promise<WebSession[]> {
  try {
    const res = await fetch(`${BASE()}/web-sessions`, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as WebSession[] | null;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build`
Expected: Compiles.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dataplane/client.ts
git commit -m "feat(console): listActiveWebSessions data-plane client"
```

---

### Task 4: `activeAgo` format helper

**Files:**
- Modify: `src/lib/console/format.ts`
- Test: `src/lib/console/format.test.ts`

**Interfaces:**
- Produces: `activeAgo(lastSeenISO: string, now: Date): string`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/console/format.test.ts`:

```ts
import { activeAgo } from "./format";

describe("activeAgo", () => {
  const N = new Date("2026-08-13T12:00:00Z");
  it("under 5s → just now", () => expect(activeAgo("2026-08-13T11:59:58Z", N)).toBe("just now"));
  it("seconds", () => expect(activeAgo("2026-08-13T11:59:15Z", N)).toBe("45s ago"));
  it("minutes (floored)", () => expect(activeAgo("2026-08-13T11:57:50Z", N)).toBe("2m ago"));
  it("future/negative clamps to just now", () => expect(activeAgo("2026-08-13T12:00:05Z", N)).toBe("just now"));
});
```

(Add `activeAgo` to the existing `import { duration, expiresIn } from "./format";` line.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/console/format.test.ts`
Expected: FAIL — `activeAgo` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/console/format.ts`:

```ts
// "just now" / "45s ago" / "2m ago" — how long since the last request in a
// web-app activity span.
export function activeAgo(lastSeenISO: string, now: Date): string {
  const secs = Math.floor((now.getTime() - new Date(lastSeenISO).getTime()) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/lib/console/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/console/format.ts src/lib/console/format.test.ts
git commit -m "feat(console): activeAgo helper"
```

---

### Task 5: Console data — merge gateway + web into a union

**Files:**
- Modify: `src/lib/console/data.ts`

**Interfaces:**
- Consumes: `listActiveWebSessions` (Task 3).
- Produces: `LiveCard` discriminated union (`kind: "gateway" | "web"`); `kpis.live` = gateway + web.

- [ ] **Step 1: Import the web client**

In `src/lib/console/data.ts`, extend the dataplane import:

```ts
import { listActiveSessions, listActiveWebSessions } from "@/lib/dataplane/client";
```

- [ ] **Step 2: Change `LiveCard` to a discriminated union**

Replace the `LiveCard` interface line with:

```ts
export type LiveCard =
  | { kind: "gateway"; sessionId: string; protocol: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number }
  | { kind: "web"; userLabel: string; siteName: string; host: string; startedAt: string; lastSeen: string; grantId: string | null };
```

- [ ] **Step 3: Fetch web sessions + resolve names/grants + build the union**

In `getConsoleData()`, add `listActiveWebSessions()` to the `Promise.all` (bind it to
`webSessions`). Then replace the user/site resolution + `live` construction block
(currently building `userMap`, `recMap`, and the `live` array) with:

```ts
  const gwUserIds = sessions.map((s) => s.userId);
  const webUserIds = webSessions.map((s) => s.userId);
  const userIds = [...new Set([...gwUserIds, ...webUserIds])];
  const gwSiteIds = sessions.map((s) => s.siteId);
  const webSiteIds = webSessions.map((s) => s.siteId);
  const siteIds = [...new Set([...gwSiteIds, ...webSiteIds])];

  const [users, sites, webGrants] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    siteIds.length ? db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true, recordSessions: true } }) : Promise.resolve([]),
    webSessions.length
      ? db.accessGrant.findMany({
          where: { status: "ACTIVE", userId: { in: [...new Set(webUserIds)] }, siteId: { in: [...new Set(webSiteIds)] } },
          select: { id: true, userId: true, siteId: true },
        })
      : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u.name || u.email]));
  const siteNameMap = new Map(sites.map((s) => [s.id, s.name]));
  const recMap = new Map(sites.map((s) => [s.id, s.recordSessions]));
  const grantMap = new Map(webGrants.map((g) => [g.userId + "\x1f" + g.siteId, g.id]));

  const gatewayCards: LiveCard[] = sessions.map((s) => ({
    kind: "gateway" as const,
    sessionId: s.sessionId, protocol: s.protocol, host: s.host,
    userLabel: userMap.get(s.userId) ?? "unknown", startedAt: s.startedAt,
    recorded: recEnabled && (recMap.get(s.siteId) ?? false), viewerCount: s.viewerCount,
  }));
  const webCards: LiveCard[] = webSessions.map((s) => ({
    kind: "web" as const,
    userLabel: userMap.get(s.userId) ?? "unknown",
    siteName: siteNameMap.get(s.siteId) ?? s.host,
    host: s.host, startedAt: s.startedAt, lastSeen: s.lastSeen,
    grantId: grantMap.get(s.userId + "\x1f" + s.siteId) ?? null,
  }));
  const live: LiveCard[] = [...gatewayCards, ...webCards];
```

Note: `recMap` previously loaded sites only when `recEnabled`; it now always loads
site names (needed for web cards), and `recorded` still gates on `recEnabled`. This
is correct and drops the earlier `recEnabled && siteIds.length` conditional.

- [ ] **Step 4: Update the LIVE kpi + return**

In the returned object, change the kpi to count both and pass `live`:

```ts
    kpis: { grants, live: sessions.length + webSessions.length, pending, expiring24h, recordings7d },
    live,
```

- [ ] **Step 5: Verify it builds**

Run: `pnpm build`
Expected: FAIL — `security-console.tsx` still reads `s.protocol`/`s.sessionId` without narrowing. That is fixed in Task 6; if you want a green build at this checkpoint, proceed to Task 6 before building. (Type errors here are expected and resolved next.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/console/data.ts
git commit -m "feat(console): merge gateway + web-app sessions into a LiveCard union"
```

---

### Task 6: Console UI — render the union + Revoke access

**Files:**
- Create: `src/app/(app)/_console/revoke-access-button.tsx`
- Modify: `src/app/(app)/_console/security-console.tsx`

**Interfaces:**
- Consumes: `activeAgo` (Task 4); the `LiveCard` union (Task 5).

- [ ] **Step 1: The Revoke access button**

Create `src/app/(app)/_console/revoke-access-button.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function RevokeAccessButton({ grantId, label }: { grantId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  async function handleClick() {
    if (!(await confirm(`Revoke ${label}'s access to this resource? Their next request will be denied.`, { danger: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/grants?id=${encodeURIComponent(grantId)}`, { method: "DELETE" });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !result?.ok) {
        setError("Couldn't revoke access, please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't revoke access, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <span>
        <button type="button" className="btn sm danger" onClick={handleClick} disabled={busy}>
          {busy ? "Revoking…" : "Revoke access"}
        </button>
        {error && <p className="notice error" role="alert">{error}</p>}
      </span>
    </>
  );
}
```

- [ ] **Step 2: Render the union in the console**

In `src/app/(app)/_console/security-console.tsx`:

- Add imports:

```tsx
import { duration, activeAgo } from "@/lib/console/format";
import { RevokeAccessButton } from "./revoke-access-button";
```

(the file already imports `duration`; add `activeAgo` to that import and add the button import.)

- Replace the `{live.map((s) => ( … ))}` block with a `kind`-branching version:

```tsx
            {live.map((s) =>
              s.kind === "gateway" ? (
                <div key={s.sessionId} className="sc-card">
                  <div className="sc-card-top">
                    <span className="sc-chip">{s.protocol.toUpperCase()}</span>
                    {s.recorded && <span className="sc-rec"><span className="sc-dot" />REC {duration(s.startedAt, now)}</span>}
                  </div>
                  <div className="sc-card-name">{s.host}</div>
                  <div className="sc-card-sub">{s.userLabel}{s.viewerCount > 0 ? ` · ${s.viewerCount} watching` : ""}</div>
                  <div className="sc-thumb">live session</div>
                  <div className="sc-card-actions">
                    <Link href={`/live/${s.sessionId}`} className="sc-watch">Watch live</Link>
                    <TerminateButton sessionId={s.sessionId} className="btn sm danger" />
                  </div>
                </div>
              ) : (
                <div key={`web:${s.userLabel}:${s.host}`} className="sc-card">
                  <div className="sc-card-top">
                    <span className="sc-chip">WEB APP</span>
                    <span className="sc-card-sub">active {activeAgo(s.lastSeen, now)}</span>
                  </div>
                  <div className="sc-card-name">{s.siteName}</div>
                  <div className="sc-card-sub">{s.userLabel} · {s.host}</div>
                  <div className="sc-thumb">web session</div>
                  <div className="sc-card-actions">
                    {s.grantId ? (
                      <RevokeAccessButton grantId={s.grantId} label={s.userLabel} />
                    ) : (
                      <span className="cell-sub">No active grant</span>
                    )}
                  </div>
                </div>
              ),
            )}
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles (the union now narrows correctly).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/_console/revoke-access-button.tsx" "src/app/(app)/_console/security-console.tsx"
git commit -m "feat(console): render web-app live cards with Revoke access"
```

---

### Task 7: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Data-plane** — Run: `cd dataplane && go build ./... && go vet ./... && go test ./...` → all PASS.
- [ ] **Step 2: Manager suite** — Run: `pnpm test` → PASS (existing + webactivity + activeAgo).
- [ ] **Step 3: Build** — Run: `pnpm build` → Compiles.
- [ ] **Step 4: Manual (Gate A, after deploy):**
  1. As a vendor, browse an internal **web-app** resource → the console home shows a **Web app** card (user · site · host, "active …"), and the LIVE KPI includes it.
  2. Stop browsing → within ~2 min the card disappears (idle-pruned).
  3. **Revoke access** on a web card → the vendor's next request to that site returns 403; the card's grant is REVOKED.
  4. A gateway (RDP/SSH) session still shows its card with **Watch live** + **Terminate**, unchanged.
  5. Data-plane restart clears web cards (in-memory) — expected.

---

## Notes for the implementer

- The tracker is best-effort and must never block the proxy hot path — `Touch` only takes a mutex briefly.
- Do not add web-app rows to `/admin/live` in this slice (deliberate follow-up; the console "All sessions →" link stays gateway-only for now).
- Deploy is **v0.44.0, manager + dataplane** (no schema/migrate/connector): bump both image tags, `docker compose up -d access-manager access-dataplane`, verify `/login` → 200, then Gate A.
- `envInt` in the data-plane is the 2-arg form `envInt(key, default)`; there is no min/max clamp variant.
