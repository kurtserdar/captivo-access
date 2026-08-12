# Vendor Portal — Requests & History Pages — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** Complete the vendor portal (2b) by adding its two remaining nav destinations: **Requests** (the vendor's own access requests) and **History** (their session history). The portal shell + My-access home already exist; the nav shipped with one item on purpose.

## Problem

The portal's top-nav has only "My access". Vendors can request access (via the home CTA) and their sessions are recorded, but they can't review their **requests** (pending / decided) or their **session history** in one place. This slice adds both pages and turns the nav into the intended three items.

## Scope

- **In:** a client `PortalNav` (path-aware active state) replacing the hardcoded nav; a **Requests** page (all self-requests, badged, withdraw on pending); a **History** page (session metadata, load-more); a pure `requestStatus` helper (tested); a vendor-scoped history GET route; light-theme `vp-*` styles.
- **Out:** recording *playback* on History (recordings are admin-only — History shows metadata only: when, what, how long); admin views; schema changes.
- **English-only. No schema change.** Deploy = **manager only**.

## Navigation

`src/app/(portal)/_nav/portal-nav.tsx` (new, client) renders three links — **My access** (`/access`), **Requests** (`/requests`), **History** (`/history`) — with the active class from `usePathname()` (active when the path equals or starts with the link). `src/app/(portal)/layout.tsx` replaces its hardcoded `<Link>My access</Link>` with `<PortalNav />`.

## Requests page — `src/app/(portal)/requests/page.tsx` (server)

- **Data:** a new `listUserRequests(userId)` in `src/lib/access/grants.ts` — `db.accessGrant.findMany({ where: { userId, requiresApproval: true }, orderBy: { createdAt: "desc" }, select: { id, createdAt, startsAt, endsAt, status, approvedAt, denyReason, note, site: { select: { name } } } })`. (The existing `listUserGrants` doesn't select `createdAt`/`note`, and mixes in non-request grants — a dedicated query is cleaner.)
- **Status:** a pure `requestStatus(g, now)` (below) → `pending | approved | denied | withdrawn | expired`.
- **Render:** the header + **"Request access"** CTA (existing `RequestAccessButton`); a list of request cards — resource name, requested-on date, a status **badge** (pending amber, approved teal, denied red, withdrawn/expired gray), the reason (`note` for the ask, or `denyReason` when denied), and a **Withdraw** button (existing `WithdrawRequestButton`) shown only when status is `pending`. Empty state: "You haven't requested any access yet." + CTA.

## History page — `src/app/(portal)/history/page.tsx` (server) + `history-list.tsx` (client)

- **Data:** `listRecordings({ userId: user.id, limit: 20, offset: 0 })` (existing) → the first page.
- **Load-more:** `history-list.tsx` (client) renders the rows and a **Load more** button that `fetch`es `GET /api/portal/history?offset=<n>` and appends, until fewer than a page returns. The route (`src/app/api/portal/history/route.ts`) does `requireUser()`, reads `offset`, and returns `listRecordings({ userId: user.id, limit: 20, offset })` mapped to JSON — **always scoped to the caller's own userId** (a vendor can never read another's history).
- **Row:** resource name (from the recording's `siteId`→name map, else `host`) · protocol · date · duration (`lastEventAt − startedAt`). **No playback link.** Empty state: "No sessions yet."

## Pure helper — `src/lib/portal/request-status.ts` (tested)

```ts
export type RequestState = "pending" | "approved" | "denied" | "withdrawn" | "expired";
export function requestStatus(
  g: { status: string; approvedAt: string | null; endsAt: string | null },
  now: Date,
): RequestState {
  if (g.status === "DENIED") return "denied";
  if (g.status === "REVOKED") return "withdrawn";
  if (!g.approvedAt) return "pending";
  if (g.endsAt && new Date(g.endsAt).getTime() < now.getTime()) return "expired";
  return "approved";
}
```

## Styles

New `vp-*` rules in `src/app/globals.css`: request card + status badge (`vp-badge` tones: amber/teal/red/gray) + history row list + a `vp-loadmore` button. Reuse the portal's light tokens (matching the existing `vp-card`/`vp-recent` styling).

## Testing

- **Unit** (`vitest`): `src/lib/portal/request-status.test.ts` — DENIED→denied, REVOKED→withdrawn, no approvedAt→pending, approved+past-end→expired, approved+future/no-end→approved.
- **Build gate:** `pnpm build`.
- **Manual (Gate A):** a vendor with a pending request sees it under **Requests** with a Withdraw button; approved/denied requests show the right badge + reason; withdrawing a pending request removes it; **History** lists their past sessions with correct duration and **Load more** pages further; a vendor cannot fetch another user's history (the route is self-scoped); nav highlights the current page; light theme renders correctly.

## Out of scope (backlog)

- Recording playback for vendors (admin-only by design).
- Request filtering/search; history date filters.
- Header live-pill; admin-audit tamper-evidence.
