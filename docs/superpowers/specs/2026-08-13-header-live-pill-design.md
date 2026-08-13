# Header Live-Pill — Design

**Status:** Approved (brainstorm 2026-08-13)
**Backlog:** console polish (header live-pill)
**Ships as:** v0.41.0 (manager only; no schema, no migrate, no dataplane, no connector)

## Goal

Show a always-visible pill in the admin console top-nav with the count of active
gateway/desktop sessions, updating in near-real-time, so an operator sees live
activity at a glance from any admin page.

## Decisions (resolved in brainstorm)

1. **Content:** live sessions count — the same figure `/admin/live` shows
   (`listActiveSessions()` = the data-plane SessionHub; browser-proxy web-app
   hits are not sessions and are not counted).
2. **Zero state:** always visible; a muted `○ Idle` pill when the count is 0.
3. **Update mechanism:** client polling every ~10s of a lightweight count
   endpoint. No server-push, no schema.

## Architecture

### Endpoint — `GET /api/admin/live/count`

- Auth: `getCurrentUser()` → 401 if absent; `can(user.role, "read_console")`
  → 403 otherwise (identical gate to `/admin/live`).
- `export const dynamic = "force-dynamic";`
- Body: `{ count: number }` where `count = (await listActiveSessions()).length`.
  `listActiveSessions()` already returns `[]` on any data-plane error, so the
  endpoint degrades to `{ count: 0 }` rather than throwing.

### Pure view helper — `src/lib/nav/live-pill.ts`

Keeps the component dumb and gives us the only unit-tested surface.

```ts
export type LivePillView = { label: string; live: boolean };
export function livePillView(count: number): LivePillView {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return n > 0 ? { label: `${n} live`, live: true } : { label: "Idle", live: false };
}
```

### Client component — `src/app/(app)/_shell/live-pill.tsx`

- `"use client"`. Renders a `<Link href="/admin/live">` styled as a pill:
  a status dot + `livePillView(count).label`. `live` toggles the active
  (teal, pulsing dot) vs muted (grey) styling.
- Initial render: muted idle placeholder (no spinner, no layout seeding), so
  there is no flash and zero added cost to every admin page render.
- Polling: `useEffect` fetches `/api/admin/live/count` immediately on mount,
  then on a 10s `setInterval`.
  - Pause when the tab is hidden (`document.visibilityState === "hidden"`):
    skip the interval fetch; on `visibilitychange` back to visible, refetch
    immediately.
  - On fetch failure or a non-OK response, keep the last known count (do not
    flip to idle/0).
  - Clear the interval and remove the listener on unmount.
- State: `const [count, setCount] = useState(0)`.

### Wiring

- `src/app/(app)/layout.tsx`: pass `showLive={showRead}` to `<TopNav>`
  (`showRead` already computed as `can(user.role, "read_console")`).
- `src/app/(app)/_shell/topnav.tsx`: add `showLive: boolean` to the props type;
  render `{showLive && <LivePill />}` as the first child of the existing
  `<div className="tn-right">` cluster (left of search/notifications).

### Styles — `src/app/globals.css`

A `.live-pill` (inline-flex, rounded, small) with `.live-pill.on` (teal accent +
pulsing `.live-dot`) and the default muted variant. Respect
`prefers-reduced-motion` for the pulse.

## Files

- Create: `src/app/api/admin/live/count/route.ts`
- Create: `src/lib/nav/live-pill.ts` + `src/lib/nav/live-pill.test.ts`
- Create: `src/app/(app)/_shell/live-pill.tsx`
- Modify: `src/app/(app)/_shell/topnav.tsx` (prop + render)
- Modify: `src/app/(app)/layout.tsx` (pass `showLive`)
- Modify: `src/app/globals.css` (pill styles)

## Testing

- `live-pill.test.ts`: `livePillView(0)` → `{ label: "Idle", live: false }`;
  `livePillView(3)` → `{ label: "3 live", live: true }`;
  `livePillView(-1)`/`NaN` → treated as 0 (Idle).
- `pnpm build` typechecks the route + component + wiring.
- Gate A (after deploy): open the console with a live gateway session → pill
  shows `● N live`; end the session → within ~10s the pill returns to `○ Idle`;
  clicking the pill opens `/admin/live`; a non-console role never sees the pill.

## Deploy

Manager-only, **v0.41.0**. Bump manager tag; `docker compose up -d
access-manager`. No migrate, no dataplane, no connector.

## Out of scope

- Per-session detail in the pill (the pill links to `/admin/live` for that).
- Any push/SSE/WebSocket channel.
- Counting browser-proxy web-app activity (not sessions).
- Pending-approvals or other signals in the same pill (approvals already have
  the nav notifications badge).
