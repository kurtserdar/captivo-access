# Header Live-Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an always-visible pill in the admin top-nav with the live gateway-session count, polling every 10s.

**Architecture:** A `read_console`-gated `GET /api/admin/live/count` returns `{ count }` from `listActiveSessions().length`. A pure `livePillView(count)` helper maps the number to a label + live flag. A `LivePill` client component in the top-nav polls the endpoint (pausing on hidden tabs, keeping the last count on error) and renders `● N live` or `○ Idle`, linking to `/admin/live`. Rendered only when the layout passes `showLive` (read_console).

**Tech Stack:** TypeScript / Next.js (App Router), React client component, vitest.

## Global Constraints

- **English only** — all code, comments, commit messages (public OSS repo).
- **No Claude signature** in commits (no `Co-Authored-By`, no "Generated with").
- **Manager-only, v0.41.0** — no Prisma schema change, no migrate, no dataplane, no connector rebuild.
- Endpoint auth mirrors the access-verify route: `getCurrentUser()` → 401 if absent, `can(user.role, "read_console")` → 403 otherwise. Do **not** use `requireUser()` (it redirects — wrong for a JSON API polled by fetch).
- Manager tests: `pnpm test`. Typecheck: `pnpm build`.

---

### Task 1: Pure view helper

**Files:**
- Create: `src/lib/nav/live-pill.ts`
- Test: `src/lib/nav/live-pill.test.ts`

**Interfaces:**
- Produces:
  - `export type LivePillView = { label: string; live: boolean };`
  - `export function livePillView(count: number): LivePillView`

- [ ] **Step 1: Write the failing test**

Create `src/lib/nav/live-pill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { livePillView } from "./live-pill";

describe("livePillView", () => {
  it("zero → Idle, not live", () => {
    expect(livePillView(0)).toEqual({ label: "Idle", live: false });
  });
  it("positive → 'N live', live", () => {
    expect(livePillView(3)).toEqual({ label: "3 live", live: true });
    expect(livePillView(1)).toEqual({ label: "1 live", live: true });
  });
  it("floors fractional counts", () => {
    expect(livePillView(2.9)).toEqual({ label: "2 live", live: true });
  });
  it("negative or non-finite → Idle", () => {
    expect(livePillView(-1)).toEqual({ label: "Idle", live: false });
    expect(livePillView(Number.NaN)).toEqual({ label: "Idle", live: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/nav/live-pill.test.ts`
Expected: FAIL — cannot find module `./live-pill`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/nav/live-pill.ts`:

```ts
export type LivePillView = { label: string; live: boolean };

// Maps an active-session count to the pill's label and live flag. Guards against
// negative / non-finite inputs (treated as idle) so the header never renders junk.
export function livePillView(count: number): LivePillView {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return n > 0 ? { label: `${n} live`, live: true } : { label: "Idle", live: false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/lib/nav/live-pill.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav/live-pill.ts src/lib/nav/live-pill.test.ts
git commit -m "feat(console): livePillView helper for the header live-pill"
```

---

### Task 2: Count endpoint

**Files:**
- Create: `src/app/api/admin/live/count/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (`@/lib/current-user`), `can` (`@/lib/auth/roles`), `listActiveSessions` (`@/lib/dataplane/client`).
- Produces: `GET /api/admin/live/count` → `{ count: number }`.

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/live/count/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listActiveSessions } from "@/lib/dataplane/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sessions = await listActiveSessions();
  return NextResponse.json({ count: sessions.length });
}
```

Note: `listActiveSessions()` already returns `[]` on any data-plane error, so this endpoint degrades to `{ count: 0 }` rather than throwing.

- [ ] **Step 2: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully (the route typechecks).

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/live/count/route.ts"
git commit -m "feat(console): live session count endpoint"
```

---

### Task 3: LivePill client component + styles

**Files:**
- Create: `src/app/(app)/_shell/live-pill.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `livePillView` (Task 1); `GET /api/admin/live/count` (Task 2).
- Produces: `export function LivePill(): JSX.Element` (no props).

- [ ] **Step 1: Write the component**

Create `src/app/(app)/_shell/live-pill.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { livePillView } from "@/lib/nav/live-pill";

const POLL_MS = 10_000;

export function LivePill() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const res = await fetch("/api/admin/live/count", { cache: "no-store" });
        if (!res.ok) return; // keep last known count on a non-OK response
        const data = (await res.json()) as { count?: number };
        if (alive && typeof data.count === "number") setCount(data.count);
      } catch {
        // network error — keep last known count
      }
    }

    refresh(); // immediate first fetch on mount
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const view = livePillView(count);
  return (
    <Link
      href="/admin/live"
      className={view.live ? "live-pill on" : "live-pill"}
      aria-label={`Live sessions: ${view.label}`}
      title="Live sessions"
    >
      <span className="live-dot" aria-hidden="true" />
      {view.label}
    </Link>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `src/app/globals.css`:

```css
.live-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: .78rem; font-weight: 600; color: var(--muted); background: var(--surface-2, rgba(127,127,127,.10)); border: 1px solid var(--line); text-decoration: none; white-space: nowrap; }
.live-pill:hover { background: var(--surface-hover); }
.live-pill .live-dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; opacity: .55; }
.live-pill.on { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.live-pill.on .live-dot { opacity: 1; animation: live-pulse 1.8s ease-in-out infinite; }
@keyframes live-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: .5; } }
@media (prefers-reduced-motion: reduce) { .live-pill.on .live-dot { animation: none; } }
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/_shell/live-pill.tsx" src/app/globals.css
git commit -m "feat(console): LivePill component + styles"
```

---

### Task 4: Wire into the top-nav

**Files:**
- Modify: `src/app/(app)/_shell/topnav.tsx` (props type + render)
- Modify: `src/app/(app)/layout.tsx` (pass `showLive`)

**Interfaces:**
- Consumes: `LivePill` (Task 3).

- [ ] **Step 1: Add the import + prop to TopNav**

In `src/app/(app)/_shell/topnav.tsx`, add the import near the other `_shell` imports (e.g. after the `LogoutButton` import):

```tsx
import { LivePill } from "./live-pill";
```

Extend the props type — change the line:

```tsx
  model: NavModel; records: SearchRecord[]; role: Role; userName: string; roleLabel: string;
```

to:

```tsx
  model: NavModel; records: SearchRecord[]; role: Role; userName: string; roleLabel: string; showLive: boolean;
```

and add `showLive` to the destructured parameter list in the function signature:

```tsx
export function TopNav({ model, records, role, userName, roleLabel, showLive }: {
```

- [ ] **Step 2: Render the pill as the first child of `tn-right`**

In `src/app/(app)/_shell/topnav.tsx`, find `<div className="tn-right">` and insert the pill as its first child:

```tsx
      <div className="tn-right">
        {showLive && <LivePill />}
        {model.showSearch && <CommandPalette records={records} role={role} />}
```

- [ ] **Step 3: Pass `showLive` from the layout**

In `src/app/(app)/layout.tsx`, the `<TopNav ... />` element already receives `role={user.role}`. Add the `showLive` prop using the already-computed `showRead`:

```tsx
      <TopNav
        model={model}
        records={searchRecords}
        role={user.role}
        userName={user.name}
        roleLabel={ROLE_LABELS[user.role] ?? user.role}
        showLive={showRead}
      />
```

- [ ] **Step 4: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/_shell/topnav.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat(console): mount LivePill in the top-nav (read_console only)"
```

---

### Task 5: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (existing + `live-pill` tests).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Manual (Gate A, after deploy):**
  1. Open the admin console with no active sessions → header shows `○ Idle` (muted).
  2. Start a gateway session → within ~10s the pill shows `● N live` (teal, pulsing dot).
  3. End the session → within ~10s the pill returns to `○ Idle`.
  4. Click the pill → navigates to `/admin/live`.
  5. Switch to another browser tab for a minute, come back → the pill refetches immediately on focus.
  6. A non-console role (a portal/vendor user) never sees the pill (it lives in the admin shell, gated by `showLive`).

---

## Notes for the implementer

- No schema, no dataplane, no connector — **manager-only**. Deploy is v0.41.0: bump the manager image tag, `docker compose up -d access-manager`. Verify `/login` → 200 after deploy, then run Gate A.
- `--accent-soft`, `--muted`, `--line`, `--surface-hover` are existing CSS variables in `globals.css`; `--surface-2` has a literal fallback in the rule. Do not invent new tokens.
- Keep the poll interval at 10s (`POLL_MS`). Do not add a shorter interval or a WebSocket — that was explicitly out of scope.
```
