# Chart interactivity polish — dashboard

**Status:** approved design (2026-08-12)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Builds on:** `2026-08-12-dashboard-redesign-design.md` (Recharts bento, v0.24.0).

## Goal

Polish the dashboard's chart interactivity: a rich hover on the custom heatmap,
click-through drill-down from the top-lists and the access trend into the pre-filtered
audit log, interactive KPI sparklines, and load/hover animation on the Recharts charts.
Manager-only, admin-only, **no schema change**.

## Approach

- The audit table already reads its filters from the URL (`userId`, `siteId`, `decision`,
  `from`, `to` via `useSearchParams`), so **drill-down is a link** — no audit-side work.
- Charts already client-side (`AccessTrend`, `Donut`, `TopBars`) get click handlers +
  active-hover state. The **heatmap** and the **KPI sparkline** become small client
  components (data stays plain-serializable props). Aggregation gains `userId` so the
  top-lists can carry stable ids for drill-down.

## Components

### 1. Aggregation — `src/lib/dashboard/insights.ts`

- `AuditRow` gains `userId: string | null`; add `userId: true` to the `getInsights` audit
  `select`.
- New pure helper (unit-tested):
  ```ts
  export interface RefCount { id: string; label: string; count: number }
  export function topRef(
    rows: AuditRow[],
    idField: "siteId" | "userId",
    nameField: "siteName" | "userEmail",
    limit: number,
    decision: "ALLOW" | "DENY" = "ALLOW",
  ): RefCount[]
  ```
  Groups by `idField` (skip null id), labels each by the row's `nameField` (fallback to the
  id when the name is null), counts, sorts desc, takes `limit`.
- `Insights.topResources` and `Insights.topVendors` change type `Labeled[] → RefCount[]`:
  - `topResources: topRef(auditRows, "siteId", "siteName", 5)`
  - `topVendors: topRef(auditRows, "userId", "userEmail", 5)`
- `topDenied` is unchanged (`topBy(auditRows, "userEmail", 3, "DENY")`, `Labeled[]`).

### 2. Top-bars drill-down — `src/app/(app)/_dashboard/charts/top-bars.tsx`

- Props change to `TopBars({ items, hrefFor }: { items: RefCount[]; hrefFor: (item: RefCount) => string })`.
- `"use client"` (already); `useRouter` from `next/navigation`. On `Bar` `onClick`, read the
  clicked datum and `router.push(hrefFor(item))`.
- Add `activeBar={{ fill: "var(--accent)", opacity: 0.85 }}`, `cursor: pointer` styling, and
  keep the existing tooltip. Empty state unchanged.

### 3. Access-trend day drill-down + active bar — `charts/access-trend.tsx`

- Keep the full ISO date on each datum (`fullDate: d.date`) alongside the display `date`.
- `useRouter`; on `Bar`/chart click, compute that UTC day's `from`/`to` and
  `router.push('/admin/audit?from=<dayStartISO>&to=<dayEndISO>')`.
- Add `activeBar` highlight to both series; keep the legend toggle + tooltip.

### 4. Donut active shape — `charts/donut.tsx`

- Add `activeIndex`/`activeShape` (or the v3 `activeShape` prop) so the hovered slice grows
  slightly; keep the tooltip + legend list. Load animation stays on (Recharts default).

### 5. Interactive KPI sparkline — `src/app/(app)/_dashboard/charts/sparkline.tsx` (new, `"use client"`)

- `Sparkline({ points, color }: { points: number[]; color: string })` — renders the polyline
  (same look as today) plus hover interaction: on `mousemove` over the SVG, find the nearest
  point and show a small dot + a tooltip (`day-index value`) positioned near the cursor;
  hide on `mouseleave`.
- `kpi-strip.tsx` stays a server component and imports this client `Sparkline` in place of its
  inline one (the local `Sparkline` is removed).

### 6. Rich heatmap hover — `src/app/(app)/_dashboard/heatmap.tsx` (→ `"use client"`)

- Convert to a client component. Track `hovered: { dow, hour } | null` in state.
- On cell `mouseenter`/`mousemove`, set hovered + show a **styled tooltip** (token colours,
  positioned near the cursor) reading `"<Day> <HH>:00 UTC — <n> access(es)"`; the hovered
  cell gets an outline highlight. Remove the native `title` attribute.
- Same grid/opacity/axis as today; data (`heatmap.grid`, `max`) stays a plain prop. **No
  drill-down** (a day-of-week × hour cell has no absolute date to map to `from`/`to`).

### 7. Composer — `src/app/(app)/_dashboard/dashboard-insights.tsx`

- Pass `hrefFor` to each `TopBars`:
  - resources → `` (i) => `/admin/audit?siteId=${encodeURIComponent(i.id)}` ``
  - vendors → `` (i) => `/admin/audit?userId=${encodeURIComponent(i.id)}` ``
- No other change (donut/heatmap/trend read the same props).

## Data flow

`getInsights()` (server) now selects `userId` and returns `RefCount[]` top-lists; the composer
builds drill-down hrefs and passes them down. All interactivity (hover, click-navigation,
animation) runs client-side; aggregation stays server-side.

## Error handling / edge cases

- **Null ids** — rows with null `siteId`/`userId` are skipped by `topRef` (no broken drill-down
  target).
- **Empty data** — top-lists/heatmap/sparklines keep their existing empty/zero states; no tooltip
  when there is nothing to hover.
- **Encoding** — drill-down ids are `encodeURIComponent`-wrapped.
- **Theme** — tooltips/highlights use CSS tokens, so light/dark both render.

## Non-goals

- No heatmap drill-down; no audit-side filter changes; no new metrics; no schema/route change.
- No new dependency (Recharts already present).

## Testing

**TS (vitest, `insights.test.ts` — extend):**
- `topRef`: groups by id, labels by name (fallback to id when name is null), skips null id,
  sorts desc, respects `limit`, honours `decision`.
- Existing `topBy`/others stay green.

**Gate A (operator, after deploy):**
- Heatmap: hovering a cell shows a styled tooltip (day/hour/count) and highlights the cell.
- Top vendors / Top resources: clicking a bar opens `/admin/audit` pre-filtered to that
  vendor / resource; the trend: clicking a day opens the audit filtered to that day.
- KPI sparklines (denials, active vendors): hovering shows a dot + value.
- Charts animate in and highlight the hovered bar/slice; light and dark both render.

## Deploy notes

- Manager-only → bump `access-manager`. No migrate. English-only + GitHub Release note.
  Suggested version **v0.25.0**.

## File map

**Create:** `_dashboard/charts/sparkline.tsx`.
**Modify:** `src/lib/dashboard/insights.ts` (+ `insights.test.ts`),
`_dashboard/charts/top-bars.tsx`, `_dashboard/charts/access-trend.tsx`,
`_dashboard/charts/donut.tsx`, `_dashboard/heatmap.tsx` (→ client),
`_dashboard/kpi-strip.tsx` (use the new Sparkline), `_dashboard/dashboard-insights.tsx`
(hrefFor wiring).
