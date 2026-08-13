# Table Search / Filter — Slice 2 of the table pass

**Status:** Approved (2026-08-13)
**Backlog:** punch-list #7, slice 2 of 3
**Ships as:** v0.47.0 (manager only; no schema, no dataplane, no connector)

## Goal

Add client-side search (and a Status filter where a status column exists) to the
growable tables that lack it, using the existing `.filter-bar` pattern.

## Scope

Tables to add filtering to (6):

| Table | Component today | Controls to add |
|---|---|---|
| Connectors | server (`connectors/page.tsx`) → extract to client | search + Status |
| Grants | server (`grants/page.tsx`) → extract to client | search + Status |
| Invites | server (`invites/page.tsx`) → extract to client | search + Status |
| Sessions | client (`sessions/sessions-table.tsx`) | search |
| Sites | client (`sites/sites-view.tsx`) | search |
| Live | client (`live/live-table.tsx`) | search |

Already have filtering (untouched): Users, Audit, Recordings, Notifications,
Directory group-mappings. Small fixed tables (passkeys, dashboard panels) stay
as-is.

## Approach

- **Client-side, in-memory** filtering — these tables load all rows (not
  paginated), so filtering is instant with no new endpoints or URL params.
- A shared pure helper `src/lib/table/filter.ts`:

  ```ts
  export function textMatch(fields: (string | null | undefined)[], query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return fields.some((f) => (f ?? "").toLowerCase().includes(q));
  }
  ```

  Unit-tested. Each table builds a per-row `fields` array (the human-visible text:
  name, email, host, company, site, status label, etc.) and filters with it.
- **Status filter** (connectors/grants/invites): a `<select>` of the distinct
  statuses; empty = All. Simple equality on the row's status.
- **Markup:** reuse the existing `.filter-bar` + `.field` / `.field-search` /
  `.select` classes (same as `users-table.tsx`). Search input debounced is
  unnecessary for in-memory (instant); plain `onChange` state.
- **Server → client extraction** (connectors/grants/invites): move the
  `<table>` render into a new `"use client"` component (`connectors-table.tsx`,
  `grants-table.tsx`, `invites-table.tsx`) that receives the already-computed row
  data as serializable props and holds the filter state. The existing per-row
  action buttons are already client components and render unchanged inside it.
  Any server-computed value a row needs (e.g. connectors' precomputed
  `updateCommand`, `managerUrlIsLocal`, `isOutdated`) is passed as a prop.

## Behavior

- Empty search → all rows. No-match → an inline "No matching rows." message inside
  the table area (reuse `.empty` or a simple row). Status "All" + empty search =
  unchanged table.
- Filtering is per-table local state; navigating away resets it (fine).
- Row count/labels unaffected; only which rows render.

## Testing

- `src/lib/table/filter.test.ts`: `textMatch` — empty query → true; case-insensitive
  substring match across fields; null/undefined fields skipped; no match → false.
- `pnpm build` typechecks all six tables + the extractions.
- Gate-A (after deploy): each of the six tables shows a search box (+ Status where
  applicable); typing narrows rows live; Status filters; clearing restores; action
  buttons still work; the refined table style (v0.46.0) is intact.

## Deploy

**v0.47.0**, manager only. Bump the manager tag, `docker compose up -d
access-manager`.

## Out of scope

- Server-side/paginated filtering (not needed at these sizes).
- Column sorting (separate idea if wanted later).
- The `/admin/sites` resources card/table redesign — that is slice 3.
