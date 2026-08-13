# Console Auto-Refresh (Poller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-refresh the Security Console home and the Sessions page every 10s so live cards + KPIs update without a manual reload.

**Architecture:** A tiny `"use client"` `AutoRefresh` component calls `router.refresh()` on a 10s interval (paused while the tab is hidden, immediate on refocus). It's mounted inside `SecurityConsole` and the `/admin/live` page — both `force-dynamic` server components, so each refresh re-fetches fresh data.

**Tech Stack:** TypeScript / Next.js (App Router client component).

## Global Constraints

- **English only** — code, comments, commit messages.
- **No Claude signature** in commits.
- **Manager-only**, no schema, no dataplane, no connector. Ships as **v0.45.0**.
- **No unit test** — a `setInterval` + `router.refresh()` + `visibilitychange` component is not meaningfully unit-testable, exactly like the existing `live-pill.tsx` (which has none). Validated by `pnpm build` + Gate-A.
- Interval **10s** (matches the header live-pill).
- Manager tests: `pnpm test`. Typecheck: `pnpm build`.

---

### Task 1: `AutoRefresh` component + mounts

**Files:**
- Create: `src/app/(app)/_shell/auto-refresh.tsx`
- Modify: `src/app/(app)/_console/security-console.tsx` (mount)
- Modify: `src/app/(app)/admin/live/page.tsx` (mount)

**Interfaces:**
- Produces: `AutoRefresh({ intervalMs?: number }): null` — a client component that periodically calls `router.refresh()`.

- [ ] **Step 1: Create the component**

Create `src/app/(app)/_shell/auto-refresh.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Periodically re-runs the current server component via router.refresh(), so a
// server-rendered page (console home, /admin/live) stays near-real-time without a
// full reload. Pauses while the tab is hidden; refreshes immediately on refocus.
// Renders nothing. Mirrors the live-pill polling pattern.
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
```

- [ ] **Step 2: Mount in the Security Console**

In `src/app/(app)/_console/security-console.tsx`:

Add the import after the existing `_console` imports (e.g. after the `ExtendButton` import):

```tsx
import { AutoRefresh } from "@/app/(app)/_shell/auto-refresh";
```

Then render it as the first child of the top-level `<div className="sc">` in the
component's `return`:

```tsx
  return (
    <div className="sc">
      <AutoRefresh />
      <div className="sc-kpis">
```

- [ ] **Step 3: Mount in the Sessions page**

In `src/app/(app)/admin/live/page.tsx`:

Add the import after the existing imports (after the `LiveTable` import on line 6):

```tsx
import { AutoRefresh } from "@/app/(app)/_shell/auto-refresh";
```

Then render it as the first child of `<main>` (line 57):

```tsx
    <main>
      <AutoRefresh />
      <div className="page-head">
```

- [ ] **Step 4: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/_shell/auto-refresh.tsx" "src/app/(app)/_console/security-console.tsx" "src/app/(app)/admin/live/page.tsx"
git commit -m "feat(console): auto-refresh the console home + sessions page every 10s"
```

---

### Task 2: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (unchanged count; no new tests per Global Constraints).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Manual (Gate A, after deploy):**
  1. Open the console home with an active session and leave the page untouched → the live cards + LIVE KPI update on their own (~10s cadence).
  2. End a web-app session → its card disappears on its own within ~2 min (idle window) with no manual reload.
  3. Background the tab for a minute → no refreshes fire; refocus → it refreshes immediately.
  4. Open a confirm dialog (e.g. begin a Revoke) and wait through a refresh → the dialog is not dismissed.
  5. `/admin/live` behaves the same.

---

## Notes for the implementer

- Do NOT add `AutoRefresh` to the console home *page* — put it inside `SecurityConsole` so it runs only for the live console, not the fresh-install getting-started checklist branch of the home page.
- Deploy is **v0.45.0, manager-only** (no schema/dataplane/connector): bump the manager image tag, `docker compose up -d access-manager`, verify `/login` → 200, then Gate A.
- `router.refresh()` preserves client state and scroll position; a background refresh does not dismiss an open dialog or reset a form.
