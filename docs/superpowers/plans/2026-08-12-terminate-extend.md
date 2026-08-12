# Terminate & Extend Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins terminate a live gateway session and quickly extend an access grant from the security console.

**Architecture:** Terminate adds a per-session close hook to the Go data-plane session hub (closing the guacd connection tears the tunnel down), exposed via a secret-gated internal endpoint and an admin-only manager route + confirm button. Extend is a one-click UI over the existing grant-update endpoint, driven by a pure `nextEndsAt` helper.

**Tech Stack:** Go (data-plane), Next.js App Router + React (manager), Vitest, TypeScript. No new dependencies, no schema change.

## Global Constraints

- English-only UI copy. No Turkish. No Claude signature/trailer in commits.
- No database schema change. **No audit** (out of scope — the codebase does not audit admin mutations; consistent).
- Terminate is **admin-only** (`can(role, "configure")`); Extend uses the existing admin-only `PATCH /api/admin/grants/[id]`.
- Deploy touches **manager + data-plane** images (no connector change).
- Test runner: `pnpm test -- <path>` (vitest). Manager build gate: `pnpm build`. Data-plane gate: `cd dataplane && go build ./... && go test ./...`.
- Confirmed reuse: data-plane internal endpoints follow the `/kick` pattern (`in.HandleFunc`, `x-dataplane-secret` gate, `writeJSON`); `hub`, `reg`, `secret` are in scope in `dataplane/main.go`. `SessionHub.Get(id) *liveSession`, `liveSession.mu sync.Mutex`. Manager `dataplane/client.ts` has `BASE()`, `authHeaders()`, and `setSessionControl` as a POST template. `useConfirm()` returns `{ confirm, dialog }` (render `{dialog}` in JSX; mirror `admin/sessions/revoke-session-button.tsx`). `PATCH /api/admin/grants/[id]` accepts `{ endsAt: ISOstring }` and enforces the policy cap.

---

### Task 1: nextEndsAt helper (pure)

**Files:**
- Create: `src/lib/console/extend.ts`
- Test: `src/lib/console/extend.test.ts`

**Interfaces:**
- Produces: `EXTEND_OPTIONS: { label: string; hours: number }[]`, `nextEndsAt(currentEndISO: string | null, hours: number, now: Date): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/console/extend.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextEndsAt, EXTEND_OPTIONS } from "./extend";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("nextEndsAt", () => {
  it("extends from a future end", () => {
    expect(nextEndsAt("2026-08-12T18:00:00Z", 24, NOW)).toBe("2026-08-13T18:00:00.000Z");
  });
  it("extends from now when the end is already past", () => {
    expect(nextEndsAt("2026-08-12T06:00:00Z", 1, NOW)).toBe("2026-08-12T13:00:00.000Z");
  });
  it("extends from now when there is no end", () => {
    expect(nextEndsAt(null, 168, NOW)).toBe("2026-08-19T12:00:00.000Z");
  });
});

describe("EXTEND_OPTIONS", () => {
  it("offers +1h / +1d / +7d", () => {
    expect(EXTEND_OPTIONS).toEqual([
      { label: "+1h", hours: 1 },
      { label: "+1d", hours: 24 },
      { label: "+7d", hours: 168 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/console/extend.test.ts`
Expected: FAIL — cannot resolve `./extend`.

- [ ] **Step 3: Write the implementation**

`src/lib/console/extend.ts`:

```ts
export const EXTEND_OPTIONS: { label: string; hours: number }[] = [
  { label: "+1h", hours: 1 },
  { label: "+1d", hours: 24 },
  { label: "+7d", hours: 168 },
];

// New end = whichever is later (the current end or now) + the increment. Extends
// a still-valid grant from its end, and a lapsing/expired one from now.
export function nextEndsAt(currentEndISO: string | null, hours: number, now: Date): string {
  const base = currentEndISO ? Math.max(now.getTime(), new Date(currentEndISO).getTime()) : now.getTime();
  return new Date(base + hours * 3600 * 1000).toISOString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/lib/console/extend.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/console/extend.ts src/lib/console/extend.test.ts
git commit -m "feat(console): nextEndsAt + extend options"
```

---

### Task 2: Data-plane session terminate

**Files:**
- Modify: `dataplane/sessionhub.go`, `dataplane/guactunnel.go`, `dataplane/main.go`
- Test: `dataplane/sessionhub_test.go`

**Interfaces:**
- Produces: `SessionHub.SetCloser(id string, fn func())`, `SessionHub.Terminate(id string) bool`; internal endpoint `POST /sessions/terminate`.

- [ ] **Step 1: Add the closer field + hub methods**

In `dataplane/sessionhub.go`, add a `closer func()` field to the `liveSession` struct (in the `mu`-guarded block):

```go
	mu           sync.Mutex
	controlOwner string
	viewers      int
	closer       func() // closes the underlying tunnel; set by guactunnel after Register
```

Add two methods (next to `SetControl`):

```go
// SetCloser records how to force-close this session's tunnel.
func (h *SessionHub) SetCloser(id string, fn func()) {
	if ls := h.Get(id); ls != nil {
		ls.mu.Lock()
		ls.closer = fn
		ls.mu.Unlock()
	}
}

// Terminate force-closes a session's tunnel. Returns false if no such session.
func (h *SessionHub) Terminate(id string) bool {
	ls := h.Get(id)
	if ls == nil {
		return false
	}
	ls.mu.Lock()
	fn := ls.closer
	ls.mu.Unlock()
	if fn != nil {
		fn()
	}
	return true
}
```

- [ ] **Step 2: Register the closer in the tunnel**

In `dataplane/guactunnel.go`, immediately after `ls := hub.Register(...)`, register the closer (the `guac` connection is already in scope from `dialGuacd`):

```go
	hub.SetCloser(sessionID, func() { _ = guac.Close() })
```

Closing `guac` makes the guacd→browser `readRawInstruction` error, the relay goroutines exit, `<-errc` returns, and the existing `defer c.CloseNow()` + `defer hub.Remove(sessionID)` tear the session down. (`_ = ls` — `ls` is already used for `vendorInputAllowed`; no change there.)

- [ ] **Step 3: Add the internal endpoint**

In `dataplane/main.go`, after the `in.HandleFunc("/kick", …)` block, add:

```go
	in.HandleFunc("/sessions/terminate", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var body struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.SessionID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_body"})
			return
		}
		found := hub.Terminate(body.SessionID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "found": found})
	})
```

- [ ] **Step 4: Write the hub test**

Create `dataplane/sessionhub_test.go` (package `main`):

```go
package main

import (
	"testing"
	"time"
)

func TestSessionHubTerminate(t *testing.T) {
	h := NewSessionHub()
	h.Register("s1", "site", "user", "rdp", "host", time.Now(), "", "", "")
	ran := 0
	h.SetCloser("s1", func() { ran++ })
	if !h.Terminate("s1") {
		t.Fatal("expected Terminate to find s1")
	}
	if ran != 1 {
		t.Fatalf("closer ran %d times, want 1", ran)
	}
	if h.Terminate("missing") {
		t.Fatal("Terminate of unknown id should return false")
	}
}
```

- [ ] **Step 5: Build + test the data-plane**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: build OK; `TestSessionHubTerminate` PASS.

- [ ] **Step 6: Commit**

```bash
git add dataplane/sessionhub.go dataplane/guactunnel.go dataplane/main.go dataplane/sessionhub_test.go
git commit -m "feat(dataplane): per-session terminate (hub closer + /sessions/terminate)"
```

---

### Task 3: Manager terminate route + client

**Files:**
- Modify: `src/lib/dataplane/client.ts`
- Create: `src/app/api/admin/live/[id]/terminate/route.ts`

**Interfaces:**
- Consumes: `/sessions/terminate` (Task 2).
- Produces: `terminateSession(sessionId): Promise<{ ok: boolean; found: boolean }>`; `POST /api/admin/live/[id]/terminate`.

- [ ] **Step 1: Add the client function**

Append to `src/lib/dataplane/client.ts` (mirroring `setSessionControl`):

```ts
export async function terminateSession(sessionId: string): Promise<{ ok: boolean; found: boolean }> {
  try {
    const res = await fetch(`${BASE()}/sessions/terminate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionId }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, found: false };
    return (await res.json()) as { ok: boolean; found: boolean };
  } catch {
    return { ok: false, found: false };
  }
}
```

- [ ] **Step 2: Add the admin route**

Create `src/app/api/admin/live/[id]/terminate/route.ts` (403 pattern matching `PATCH /api/admin/grants/[id]`):

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { terminateSession } from "@/lib/dataplane/client";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const result = await terminateSession(id);
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dataplane/client.ts "src/app/api/admin/live/[id]/terminate/route.ts"
git commit -m "feat(admin): terminate-session route + data-plane client"
```

---

### Task 4: Terminate + Extend buttons and wiring

**Files:**
- Create: `src/app/(app)/_console/terminate-button.tsx`, `src/app/(app)/_console/extend-button.tsx`
- Modify: `src/app/(app)/_console/security-console.tsx`, `src/app/(app)/admin/live/live-table.tsx`, `src/app/(app)/admin/live/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `terminateSession` route (Task 3), `EXTEND_OPTIONS`/`nextEndsAt` (Task 1), `useConfirm`.

- [ ] **Step 1: TerminateButton**

Create `src/app/(app)/_console/terminate-button.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function TerminateButton({ sessionId, className }: { sessionId: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  async function handleClick() {
    if (!(await confirm("Terminate this session? The user will be disconnected immediately.", { danger: true, confirmLabel: "Terminate" }))) return;
    setBusy(true);
    try { await fetch(`/api/admin/live/${sessionId}/terminate`, { method: "POST" }); }
    catch { /* refresh will reflect reality */ }
    router.refresh();
  }

  return (
    <>
      {dialog}
      <button type="button" className={className ?? "btn sm danger"} onClick={handleClick} disabled={busy}>
        {busy ? "Terminating…" : "Terminate"}
      </button>
    </>
  );
}
```

- [ ] **Step 2: ExtendButton**

Create `src/app/(app)/_console/extend-button.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXTEND_OPTIONS, nextEndsAt } from "@/lib/console/extend";

export function ExtendButton({ grantId, endsAt }: { grantId: string; endsAt: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function extend(hours: number) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endsAt: nextEndsAt(endsAt, hours, new Date()) }),
      });
      if (!res.ok) { setErr("Exceeds the maximum grant length"); setBusy(false); return; }
      router.refresh();
    } catch {
      setErr("Couldn't extend"); setBusy(false);
    }
  }

  return (
    <span className="sc-extend">
      {EXTEND_OPTIONS.map((o) => (
        <button key={o.label} type="button" className="btn sm" disabled={busy} onClick={() => extend(o.hours)}>{o.label}</button>
      ))}
      {err && <span className="sc-extend-err">{err}</span>}
    </span>
  );
}
```

- [ ] **Step 3: Wire into the console**

In `src/app/(app)/_console/security-console.tsx`:

(a) Add imports at the top:
```tsx
import { TerminateButton } from "./terminate-button";
import { ExtendButton } from "./extend-button";
```

(b) In each live card, add a Terminate action next to the Watch link — replace:
```tsx
                <Link href={`/live/${s.sessionId}`} className="sc-watch">Watch live</Link>
```
with:
```tsx
                <div className="sc-card-actions">
                  <Link href={`/live/${s.sessionId}`} className="sc-watch">Watch live</Link>
                  <TerminateButton sessionId={s.sessionId} className="btn sm danger" />
                </div>
```

(c) Replace the expiring row (currently a whole-row `<Link>`) so an ExtendButton can live beside a link — replace:
```tsx
              <Link key={e.id} href="/admin/grants" className="sc-exp">
                <span className="sc-exp-t">{e.userLabel} → {e.siteName}</span>
                <span className="sc-exp-left">{expiresIn(e.endsAt, now)}</span>
              </Link>
```
with:
```tsx
              <div key={e.id} className="sc-exp">
                <Link href="/admin/grants" className="sc-exp-t">{e.userLabel} → {e.siteName}</Link>
                <span className="sc-exp-left">{expiresIn(e.endsAt, now)}</span>
                <ExtendButton grantId={e.id} endsAt={e.endsAt} />
              </div>
```

- [ ] **Step 4: Wire into /admin/live (admin-only)**

In `src/app/(app)/admin/live/live-table.tsx`: add `canTerminate` to the props and render Terminate inside the **existing** `row-actions` cell, right after the Watch link (no new column/header). Change the signature to `LiveTable({ rows, canTerminate }: { rows: LiveRow[]; canTerminate: boolean })` and, inside the `<td className="row-actions">` that holds `<Link … className="btn sm">Watch</Link>`, add after it:
```tsx
{canTerminate && <TerminateButton sessionId={r.sessionId} className="btn sm danger" />}
```
Add `import { TerminateButton } from "@/app/(app)/_console/terminate-button";` at the top. (If the row-actions cell holds a single element today, wrap the Watch link + Terminate button in a `<span style={{ display: "inline-flex", gap: 8 }}>` so they sit side by side.)

In `src/app/(app)/admin/live/page.tsx`: compute `const canTerminate = can(user.role, "configure");` (the page already has `user` and imports `can`) and pass `canTerminate={canTerminate}` to `<LiveTable ... />`.

- [ ] **Step 5: Add styles**

Append to the `/* Security console */` section in `src/app/globals.css`:

```css
.sc-card-actions { display: flex; gap: 8px; }
.sc-card-actions .sc-watch { flex: 1; }
.sc-extend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sc-extend-err { font-size: .72rem; color: var(--danger); }
```

- [ ] **Step 6: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/_console/terminate-button.tsx" "src/app/(app)/_console/extend-button.tsx" "src/app/(app)/_console/security-console.tsx" "src/app/(app)/admin/live/live-table.tsx" "src/app/(app)/admin/live/page.tsx" src/app/globals.css
git commit -m "feat(console): Terminate + Extend buttons on console and live sessions"
```

---

### Task 5: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Manager suite** — Run: `pnpm test` → PASS (existing + `extend` test).
- [ ] **Step 2: Manager build** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Data-plane** — Run: `cd dataplane && go build ./... && go test ./...` → build OK + hub test PASS.
- [ ] **Step 4: Manual (Gate A, live — deploy manager + data-plane, separate user-approved step):**
  1. Open a gateway session; on the console live card click **Terminate** → confirm → the browser session drops within a second and the card disappears on refresh.
  2. `/admin/live`: an ADMIN sees Terminate per row and it works; an OPERATOR/AUDITOR sees no Terminate button.
  3. On the console **Expiring soon**, click **+1d** on a grant → its countdown jumps ~a day; **+7d** likewise; extending past the policy cap shows "Exceeds the maximum grant length" and does not change it.
  4. Terminating an already-ended session (race) just refreshes with the card gone (no error surfaced to the user).

---

## Notes for the implementer

- Deploy (separate, user-approved) needs **both** `access-manager` and `access-dataplane` images at the new tag — the terminate endpoint lives in the data-plane.
- No audit is written (consistent with existing admin mutations; auditing admin actions is a separate backlog slice).
- Terminate stays admin-only; the console is already admin-only, so its cards always show Terminate; `/admin/live` gates the button on `canTerminate`.
