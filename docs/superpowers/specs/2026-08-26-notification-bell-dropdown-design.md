# Notification Bell Dropdown — Design

**Date:** 2026-08-26
**Status:** Approved (design), pending implementation
**Related:** topnav notification bell, `/admin/notifications` page

## Problem

The header notification bell (`topnav.tsx`) is a plain `<Link href="/admin/notifications">` — clicking it navigates straight to the full notifications page. There's no quick way to glance at recent unread notifications, act on them (mark read / delete), and stay where you are. The user wants the bell to open a small dropdown panel instead, with a link into the full page only if they choose.

## Current state

- **Bell:** `src/app/(app)/_shell/topnav.tsx:92-96` — a `Link` with a badge showing `model.notificationsBadge` (unread count). The topnav already has an `open` dropdown state used by the account menu — the same pattern applies here.
- **Model:** `Notification { id, type, siteId?, siteName, detail?, createdAt, readAt? }` (`type` is `"site_down" | "site_recovered"`).
- **APIs today:** `POST /api/admin/notifications/read` (mark ALL read, `read_console`-gated) and `POST /api/admin/notifications/[id]/read` (mark ONE read). **No list endpoint, no delete.**
- **Badge source:** `buildNavModel(role, { unread })` → `notificationsBadge` (server-side, `src/lib/nav/model.ts`).

## Goals

- Bell opens a dropdown panel (not a navigation) showing recent **unread** notifications.
- Per-item **mark as read** and **delete**; a **"mark all read"** action; a **"View all notifications →"** link to `/admin/notifications`.
- **Opening the dropdown does NOT auto-mark anything read** — the badge only changes when the user acts. (Explicit user requirement: "opened but didn't read, don't lose it.")
- Reuse the existing mark-read APIs; add only what's missing (list + delete).

## Non-goals

- No change to the full `/admin/notifications` page.
- No realtime push — the dropdown fetches on open.
- No new notification types or model change.

## Design

### 1. List endpoint (new) — `GET /api/admin/notifications`

`src/app/api/admin/notifications/route.ts` (new GET). `read_console`-gated (same as the others). Returns the most recent **unread** notifications for the dropdown plus the unread count:

```ts
// where: { readAt: null }, orderBy createdAt desc, take 8
return NextResponse.json({
  items: rows.map(n => ({ id, type, siteName, detail, when: timeAgo(n.createdAt) })),
  unread: <count of readAt: null>,
});
```

(`take 8` for the panel; `unread` is the full count so the badge and an "N more" hint stay accurate.)

### 2. Delete endpoint (new) — `DELETE /api/admin/notifications/[id]`

`src/app/api/admin/notifications/[id]/route.ts` (new file, `DELETE`). `read_console`-gated. `db.notification.delete({ where: { id } })` (permanent removal — distinct from mark-read). Idempotent-ish: use `deleteMany({ where: { id } })` so a double-delete returns ok, not a 500.

### 3. Bell component (rework) — `src/app/(app)/_shell/`

Replace the bell `<Link>` with a client dropdown component (mirroring the account menu's toggle):

- **Toggle:** the bell button toggles the panel via the topnav's `open` state (`open === "notifications"`).
- **On open:** `fetch('/api/admin/notifications')` → render `items`.
- **Panel contents:**
  - Header row: "Notifications" + **"Mark all read"** button (calls `POST /read`).
  - List: each item shows a title (from `type` → friendly label, e.g. "Resource down" / "Resource recovered") + `siteName` + `when`, with two actions: **mark read** (`POST /[id]/read`) and **delete** (`DELETE /[id]`).
  - Empty state: "You're all caught up." when `items` is empty.
  - Footer: **"View all notifications →"** `Link` to `/admin/notifications`; if `unread > items.length`, show "and N more".
- **After any action:** re-fetch the panel list AND call `router.refresh()` so the server-rendered badge (`notificationsBadge`) updates. The badge never changes just from opening the panel.

### 4. topnav wiring

`topnav.tsx`: swap the bell `Link` block for `<NotificationBell badge={model.notificationsBadge} open={open === "notifications"} onToggle={...} />`, gated by the same `model.showNotifications`.

## Authorization

All three endpoints (`GET` list, existing mark-read, new `DELETE`) require `read_console` — consistent with the current mark-read routes and the notifications page. Roles that can see notifications can also clear them.

## Testing

- Route handlers aren't unit-tested in this repo (convention) — verify by build + manual.
- Manual: bell opens a panel (no navigation); unread items listed; mark-read removes an item + decrements badge after refresh; delete removes it permanently; "mark all read" empties the panel + zeroes the badge; opening the panel alone changes nothing; "View all" navigates to the full page.

## Rollout

- **Manager-only** — no schema change, no dataplane/connector, no `db push`.
- Ship as its own release tag; bump manager (+ migrate for tag discipline). English user-facing release note.
- Deploy is a separate, explicitly-approved step.
