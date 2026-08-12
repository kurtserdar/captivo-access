# Admin Top-Nav Shell — Design (Slice 2a-1)

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** 2a-1 of the dashboard redesign — replace the admin **sidebar** with a **grouped-dropdown top-nav** (approach B1). The #2a home *content* (KPI band, live-session cards, requests, audit stream) is a separate later slice (2a-2); this slice changes only the shell/chrome, not page content.

## Problem

The admin console (`(app)` route group) navigates via a navy left **sidebar** (`src/app/(app)/layout.tsx`) with ~17 items in 5 groups. The #2a design calls for a horizontal **top-nav** console. This slice swaps the shell to a top-nav while keeping every existing page reachable, capability-gated, searchable (⌘K), and mobile-friendly.

## Scope

- **In:** replace the sidebar layout with a top-nav; a capability-gated nav model; grouped dropdowns for the long tail; preserve ⌘K search, theme switcher, update banner, notifications badge, grants badge, account menu, and a mobile drawer.
- **Out:** the #2a home content (2a-2); relocating the Insights dashboard (2a-2); the header "live sessions" pill (2a-2); any change to page *content* or routes; schema changes. No new pages, no removed pages.
- **English-only. No schema change. No Claude signature.**
- The app is already teal-accented (`--accent:#0d9488` / `--nav-accent:#2ee6c9`) — reuse existing theme tokens; **no re-accent** in this slice.

## Information architecture (the core of this slice)

The 17 pages map onto a top-nav with two dropdown groups. Every item keeps its current capability gate (`can(role, cap)`), so OPERATOR/AUDITOR see the read-console subset and ADMIN sees all. (VENDOR/STAFF never reach `(app)` — they're redirected to the portal.)

**Primary bar (left → right, after the brand):**
| Label | Target | Gate | Notes |
|---|---|---|---|
| Console | `/` | read_console | home |
| Access | `/admin/grants` | read_console | pending-grants badge (approve_grants) |
| Sessions | `/admin/live` | read_console | live gateway sessions |
| Recordings | `/admin/recordings` | configure | |
| Audit | `/admin/audit` | read_console | |
| Infrastructure ▾ | dropdown | configure | Connectors · Resources · Email · Single sign-on · Directory · Policy · Custom domain · Updates |
| People ▾ | dropdown | configure | Users · Invites · Sessions (auth) |

**Right cluster:**
- Search (⌘K) — existing `CommandPalette` (read_console).
- Notifications — bell → `/admin/notifications` with unread badge (read_console).
- Theme switcher — existing `ThemeSwitcher`.
- Account ▾ — identity (name + role), **My access** (`/access`), **Settings** (`/settings/passkeys`), **Log out** (existing `LogoutButton`).

A dropdown renders only the sub-items the role may see; a dropdown with no visible sub-items is not shown. The active route highlights its primary item (and its parent dropdown when a sub-item is active).

## Components

### `src/lib/nav/model.ts` (new, pure, unit-tested)
Builds the gated nav model so gating logic is testable in isolation:

```ts
export interface NavItem { label: string; href: string; badge?: number }
export interface NavGroup { label: string; items: NavItem[] }
export interface NavModel {
  primary: NavItem[];            // Console, Access, Sessions, Recordings, Audit
  groups: NavGroup[];            // Infrastructure, People (only if non-empty)
  showSearch: boolean;
  showNotifications: boolean;
  notificationsBadge: number;
}
export function buildNavModel(role: Role, counts: { pending: number; unread: number }): NavModel;
```

Gating uses the existing `can(role, cap)` from `@/lib/auth/roles`. Empty groups are omitted; badges are `0`-suppressed by the renderer.

### `src/app/(app)/_shell/topnav.tsx` (new, client)
`TopNav({ model, user, roleLabel })` — renders the horizontal bar on desktop and a hamburger-driven drawer on mobile. Dropdowns are keyboard-accessible (button + `aria-expanded`, `Esc` closes, click-outside closes, focus-visible ring). The mobile drawer lists the primary items and each group as an expanded section, plus the account actions. Reuses the `document.documentElement.dataset.navOpen` pattern from the retired `mobile-nav.tsx`.

### `src/app/(app)/layout.tsx` (rewrite the shell)
Compute the same server data it already gathers (`requireUser`, `countPendingGrants`, `countUnreadNotifications`, `getSearchRecords`, update-check), call `buildNavModel(user.role, { pending, unread })`, and render:

```
<div class="app">                       // was .app-shell (grid); now column
  <TopNav model … user … />              // brand + primary + groups + right cluster (search/notifications/theme/account)
  {showConfig && <UpdateBanner …/>}
  <main class="content">{children}</main>
</div>
```

`CommandPalette` and `ThemeSwitcher` move into `TopNav`'s right cluster (they were in `Topbar`). The old `Topbar` and `mobile-nav.tsx` are retired (their behavior folds into `TopNav`); the old `NavLink` sidebar component is retired.

### `src/app/globals.css`
Replace the `.app-shell` grid + `.sidebar` / `.nav-scroll` / `.nav-group` block with `.app` (flex column) + `.topnav` styles (bar, primary links, dropdown menu, right cluster, active state) + a `.topnav`-scoped mobile drawer. Keep `.content`, `.main-col` semantics folded into `.app`. Reuse existing tokens (`--nav-bg`, `--nav-line`, `--nav-accent`, `--accent`, `--nav-badge`). Remove now-dead sidebar rules.

## Data flow

Unchanged from today — the layout already reads `pending` and `unread` counts and search records; we feed them through `buildNavModel` instead of inlining the sidebar JSX. No new queries. The header "live sessions" pill is explicitly deferred to 2a-2 (it needs a live-count source and belongs with the console content).

## Accessibility & mobile

- Dropdowns: trigger is a `<button aria-haspopup="menu" aria-expanded>`; menu items are links; `Esc` and outside-click close; focus returns to the trigger.
- Keyboard: primary items and triggers are tab-reachable; visible focus ring (existing `:focus-visible` token).
- Mobile (`≤ breakpoint`): the horizontal bar collapses to brand + hamburger + search + account; the hamburger opens the full nav as a drawer (same scrim/`data-nav-open` mechanism).

## Testing

- **Unit** (`vitest`): `src/lib/nav/model.test.ts` — `buildNavModel` for ADMIN (all items + both groups), OPERATOR (read-console + grants badge, no Infrastructure/People), AUDITOR (read-console, no grants badge, no config groups); badge `0`-suppression; empty group omission.
- **Build gate:** `pnpm build`.
- **Manual:** ADMIN sees full top-nav + both dropdowns; dropdowns open/close by click + `Esc`; active route highlights; ⌘K still opens search; notifications/grants badges show; theme switch works; account menu → My access / Settings / Logout; mobile hamburger drawer reaches every page; OPERATOR/AUDITOR see the correctly reduced nav; every one of the 17 pages is reachable.

## Out of scope (next slices)

- **2a-2:** the #2a home content (KPI band, live-session cards with Watch/Terminate, pending-requests panel, expiring + connectors, audit stream) + relocating the current Insights dashboard to its own "Insights"/"Analytics" destination + the header live-sessions pill.
- Portal Requests/History; gateway file-transfer audit trail.
