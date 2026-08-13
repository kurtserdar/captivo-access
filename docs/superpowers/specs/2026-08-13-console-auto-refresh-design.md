# Console Auto-Refresh (Poller) — Design

**Status:** Approved (brainstorm 2026-08-13)
**Backlog:** punch-list #6 (console near-real-time refresh, not full-page reload)
**Ships as:** v0.45.0 (manager only; no schema, no dataplane, no connector)

## Goal

The Security Console home and the Sessions page (`/admin/live`) are server
components; their live cards (gateway + web-app) go stale until the admin manually
reloads. Add a lightweight poller so both pages auto-refresh in near-real-time —
so, e.g., a web-app card drops on its own within ~2 min of the vendor stopping,
with no manual reload.

## Decisions (resolved in brainstorm)

1. **Mechanism:** `router.refresh()` on an interval (whole-page). Re-runs the
   server component, streams fresh RSC, React reconciles without a scroll jump and
   preserves client state. Chosen over a targeted JSON endpoint — it is the
   codebase's existing idiom (~10 mutation buttons call `router.refresh()`),
   needs no new endpoint, and makes the whole console live (KPIs, all sections),
   not just the live cards.
2. **Interval:** 10s (matches the header live-pill).
3. **Pages:** the console home (Security Console) and `/admin/live`.
4. **Pause when hidden:** yes — no refresh while the tab is backgrounded; on
   regaining focus, refresh immediately.

## Architecture

### New component — `src/app/(app)/_shell/auto-refresh.tsx`

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

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

Mirrors the live-pill's proven polling shape (interval + `visibilitychange`,
cleanup on unmount). Renders nothing.

### Mount points

- **Console home:** render `<AutoRefresh />` inside `SecurityConsole`
  (`src/app/(app)/_console/security-console.tsx`). Placing it in `SecurityConsole`
  (rather than the page) means it runs only for the live console, not the
  fresh-install getting-started checklist branch of the home page.
- **Sessions page:** render `<AutoRefresh />` in
  `src/app/(app)/admin/live/page.tsx` (both pages already `force-dynamic`, so each
  refresh re-fetches fresh data).

Both use the default 10s interval.

## Behavior notes

- `router.refresh()` is non-disruptive: it re-renders server components and
  reconciles; client component state (e.g. an open confirm dialog mid-Revoke)
  survives, and scroll position is preserved.
- Each refresh re-runs the page's server queries (`getConsoleData()` ≈ 10 queries
  + 2 data-plane calls for the console; the live page's user/site/grant lookups).
  Acceptable at this product's scale (few admins). If load ever mattered, a
  targeted endpoint is the fallback — out of scope now (YAGNI).
- Combined with the web-activity idle window (120s), an ended web session's card
  now disappears on its own within ~2 min with no manual reload.

## Testing

- No unit test: a `setInterval` + `router.refresh()` + `visibilitychange`
  component is not meaningfully unit-testable, exactly like the existing
  `live-pill.tsx` (which has none). Validated by `pnpm build` + Gate-A.
- `pnpm build` typechecks the component + its two mounts.
- Gate-A (after deploy): open the console with an active session → leave the page
  untouched → the live cards + LIVE KPI update on their own (~10s cadence); end a
  web session → its card drops within ~2 min without a manual reload; background
  the tab for a while → no refreshes; refocus → it refreshes immediately; an open
  confirm dialog is not dismissed by a background refresh.

## Deploy

**v0.45.0**, manager only. No schema, no dataplane, no connector. Bump the manager
tag, `docker compose up -d access-manager`.

## Out of scope

- A targeted JSON/partial-refresh endpoint (fallback only if query load ever
  matters).
- Auto-refresh on other pages (this slice: console home + `/admin/live`).
- Websocket/SSE push (polling is sufficient and matches the existing pill).
