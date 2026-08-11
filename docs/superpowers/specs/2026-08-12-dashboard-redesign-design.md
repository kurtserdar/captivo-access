# Dashboard redesign (B-refined) — interactive charts + richer metrics

**Status:** approved design (2026-08-12)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Supersedes the rendering of:** `2026-08-11-dashboard-insights-design.md` (that shipped
hand-rolled SVG; this replaces it with a Recharts bento and adds metrics).

## Goal

Replace the current admin dashboard (stat cards + hand-rolled SVG Insights) with a
**"B-refined" bento**: a clean KPI strip on top, then a 12-column grid of
**interactive Recharts charts** (hover tooltips, click-legend-to-toggle a series),
plus new metrics. Existing Resource-health and Recent-activity panels stay below.
Fixed **last-30-days** window. Manager-only, admin-only, **no schema change**.

## Approach

- **Recharts 3** (React-19 compatible) for the trend, donuts, and top-bars — added as
  a bundled npm dependency. No global CSP in captivo-access, so a bundled chart lib +
  client components are fine. Charts are `"use client"`; data is fetched server-side and
  passed as plain-serializable props.
- **Theme-aware colours:** charts take colours as CSS-token strings (`var(--ok)`,
  `var(--danger)`, `var(--accent)`, `var(--warn)`) which cascade into Recharts' SVG, so
  light/dark both work with no JS. Tooltips styled via token-based `contentStyle`.
- **Custom pieces stay hand-rolled** (no Recharts): the **heatmap** (7×24 grid with
  native `title` tooltips — server-rendered) and the **KPI sparklines** (tiny inline
  SVG). Recharts has no heatmap and sparklines don't need it.
- **One server fetch** feeds pure, unit-tested aggregation helpers (extends the existing
  `getInsights()`); the KPI strip also reuses the existing `getDashboardStats()`.

## Data — all from existing tables (verified), no schema change

`Connector` (status/version/lastSeenAt), `Site` (accessMode TRANSPARENT=web /
GATEWAY=remote), `AccessGrant` (status/endsAt/pending), `AuditEvent` 30d
(timestamp/decision/siteId/siteName/userEmail/clientIp/reason), `SessionRecording`
(startedAt/lastEventAt/format/protocol), and live `listActiveSessions()`.

## Layout (B-refined)

- **KPI strip** (6 tiles, responsive → 3-col → 2-col):
  1. **Connectors** online/total (+ "N outdated" note) — from `getDashboardStats`.
  2. **Resources** reachable/total — from `getDashboardStats` (label "Resources", not "Sites").
  3. **Active grants** (+ "N pending approval" sub) — from `getDashboardStats`.
  4. ⭐ **Sessions now** (+ "longest Xh Ym" sub) — from `insights.activeSessions`.
  5. **Denials 30d** + red sparkline — count from `insights.deny.total`, sparkline from `insights.trend[].deny`.
  6. ⭐ **Active vendors 30d** + sparkline — from `insights.activeVendors`.

  Sparklines appear only on audit-derived tiles (denials, vendors) — the point-in-time
  tiles (connectors/resources/grants/sessions) get a value + a short sub, no fake trend.

- **Bento** (12-col grid, collapses to 1-col on mobile):
  - **Access — 30 days** (anchor, span 7 × 2 rows): Recharts **stacked bar**, allowed
    (`--ok`) + denied (`--danger`) per day, hover tooltip, legend click toggles a series.
  - **When vendors connect** (span 5): custom heatmap, hover `title` tooltip, peak callout.
  - **Deny reasons** (span 5): Recharts donut (top reasons) + legend list.
  - ⭐ **Access type mix** (span 4): Recharts donut — Web vs Remote, from ALLOW events joined to `Site.accessMode`.
  - **Top resources** (span 4): Recharts horizontal bars.
  - **Top vendors** (span 4): Recharts horizontal bars.
  - ⭐ **Session activity 30d** (span 4): three numbers — recordings · hours captured · avg length.
  - **Attention** (span 12): IP-diversity flags · grants expiring 7d · ⭐ **Top denied** (vendor + count/reason).

- **Below (existing, unchanged):** Resource-health panel + Recent-activity panel.

⭐ = new vs the current dashboard.

## Components

### 1. Aggregation — extend `src/lib/dashboard/insights.ts`

`AuditRow` gains `siteId: string | null` (added to the fetch `select`).

Generalise + add pure helpers (all unit-tested):
- `topBy(rows, field, limit, decision = "ALLOW")` — add the `decision` param (default keeps
  existing behaviour); update the two existing call sites.
- `activeVendors(rows, now, days = 30): { count: number; series: number[] }` — `count` =
  distinct `userEmail` with ALLOW in window; `series` = 30 daily distinct-vendor counts
  (oldest→newest, UTC), for the sparkline.
- `typeMix(rows, siteType: Map<string, "web" | "remote">): { web: number; remote: number }`
  — ALLOW events bucketed by their site's accessMode via `siteId`; null/unmatched skipped.
- `sessionStats(recs: { startedAt: Date; lastEventAt: Date }[]): { recordings: number; totalHours: number; avgMinutes: number }`
  — `recordings` = count; `totalHours` = round(sum(lastEventAt−startedAt)/1h); `avgMinutes`
  = round(mean duration in minutes), 0 when empty.

Extend `Insights` and `getInsights()`:
- Add to the audit `select`: `siteId: true`.
- Fetch `db.site.findMany({ select: { id: true, accessMode: true } })` → build the
  `siteType` map (`TRANSPARENT → "web"`, `GATEWAY → "remote"`).
- Fetch `db.sessionRecording.findMany({ where: { startedAt: { gte: since } }, select: { startedAt: true, lastEventAt: true } })`.
- Add to the return: `activeVendors`, `typeMix`, `sessionStats`,
  `topDenied: topBy(auditRows, "userEmail", 3, "DENY")`.

`Insights` gains:
```ts
activeVendors: { count: number; series: number[] };
typeMix: { web: number; remote: number };
sessionStats: { recordings: number; totalHours: number; avgMinutes: number };
topDenied: Labeled[];
```

### 2. Recharts client charts — `src/app/(app)/_dashboard/charts/` (all `"use client"`)

- `access-trend.tsx` — `AccessTrend({ data: TrendDay[] })`: `ResponsiveContainer` +
  stacked `BarChart` (two `Bar`s, `fill="var(--ok)"` / `var(--danger)"`), `Tooltip`
  (token `contentStyle`), `Legend` with click-to-toggle (local `useState` of hidden
  series → `hide` prop on the `Bar`). X axis = short date, sparse ticks.
- `donut.tsx` — `Donut({ slices: { label: string; value: number; color: string }[], total?: number })`:
  `PieChart` with an inner radius + `Tooltip` + a legend list beside it. Reused by **Deny
  reasons** (colours `--danger`/`--warn`/`--accent`/…) and **Access type mix** (`--ok` web,
  `--accent`/blue remote).
- `top-bars.tsx` — `TopBars({ items: Labeled[] })`: horizontal `BarChart`
  (`layout="vertical"`), `fill="var(--accent)"`, `Tooltip`, truncated Y labels. Reused by
  Top resources + Top vendors. Empty state when `items` is empty.

Colours are passed as CSS-var strings so both themes work.

### 3. Server presentational pieces — `src/app/(app)/_dashboard/`

- `kpi-strip.tsx` — `KpiStrip({ stats, insights })`: 6 tiles; custom inline-SVG sparkline
  helper for the denials (red) and vendors (accent) tiles.
- `heatmap.tsx` — extracted from the current `insights-panel.tsx` `Heatmap`, unchanged
  behaviour (grid + `title` tooltips + UTC note + peak callout).
- `session-stats.tsx` — three-number tile from `insights.sessionStats`.
- `attention-panel.tsx` — IP-diversity flags · grants expiring (7d) · top denied.
- `dashboard-insights.tsx` — the **bento composer** (server): lays out the KPI strip, the
  bento grid (embedding the client charts + heatmap + session-stats + attention), using
  the new CSS classes. Replaces the old `insights-panel.tsx` (which is deleted).

### 4. Home page — `src/app/(app)/page.tsx`

In the admin branch, fetch `getInsights()` alongside the existing calls and render
`<DashboardInsights stats={stats} insights={insights} />` in place of the current
`<StatCards s={stats} />` + `<InsightsPanel …>` (the KPI strip absorbs the stat cards).
The `dash-cols` Resource-health + Recent-activity panels stay directly below.

### 5. Styles — `src/app/globals.css`

Replace the current `/* Dashboard insights */` block with: `.kpis`/`.kpi` strip,
`.bento` 12-col grid + the `.c-*` span classes (with the mobile 1-col collapse), card
chrome, `.toplist`/heatmap/attention/session classes. Reuse existing tokens
(`--ok`/`--danger`/`--warn`/`--accent`/`--muted`/`--line`/`--surface-2`). (Note: the CSS
lives in `src/app/globals.css`, not `(app)/globals.css`.)

## Data flow

`page.tsx` (admin, server) → `getDashboardStats()` + `getInsights()` (one audit fetch +
sites + recordings + grants + live sessions; pure helpers shape it) → `DashboardInsights`
composes server pieces and passes plain arrays into the `"use client"` Recharts charts.
Only chart interactivity runs on the client; all aggregation stays server-side.

## Error handling / edge cases

- **No data** (fresh install) → each chart/list shows an empty state; KPIs show 0; heatmap
  all-empty; donuts render nothing rather than a broken ring.
- **Data-plane offline** → `listActiveSessions()` → `[]` → Sessions KPI shows 0.
- **Null fields** — `siteId`/`siteName`/`userEmail`/`clientIp`/`reason` may be null; helpers
  skip nulls (`typeMix` skips null/unmatched `siteId`; `reason` null → "unspecified").
- **UTC bucketing** — trend/heatmap/vendor-series are UTC (noted in the UI).
- **Recharts + SSR** — charts are client components inside `ResponsiveContainer`; guard
  against zero-width flashes with a min-height on their card.

## Non-goals

- No time-window selector (fixed 30 days), no CSV/PDF export, no per-tenant TZ.
- No "Sites → Resources" data/route rename (separate slice); this only relabels the KPI
  tile + card titles to "Resources" in the new dashboard copy.
- No new schema, no data-plane/connector change.

## Testing

**TS (vitest, `src/lib/dashboard/insights.test.ts` — extend):**
- `topBy` with `decision: "DENY"` returns DENY-grouped top-N (existing ALLOW test stays).
- `activeVendors`: distinct-vendor `count` over the window + a 30-length daily `series`
  with the right day buckets (fixed `now`).
- `typeMix`: ALLOW events bucketed web/remote via the `siteType` map; null/unmatched siteId skipped.
- `sessionStats`: `recordings`/`totalHours`/`avgMinutes` from a few durations; empty → zeros.

**Gate A (live, operator, after deploy):** the admin home shows the KPI strip (6 tiles,
sparklines on denials + vendors), the bento with a hovering Access tooltip and a
legend-toggle that hides Denied, the heatmap lighting up on active hours, both donuts,
top resources/vendors bars, session-activity numbers, and the attention panel; a fresh
install shows tasteful empty states; light and dark both render.

## Deploy notes

- Adds `recharts@^3` dependency (bundled). Manager-only → bump `access-manager`. No
  migrate, no data-plane/connector change. English-only + GitHub Release note.

## File map

**Add dep:** `recharts@^3`.
**Create:** `_dashboard/charts/access-trend.tsx`, `_dashboard/charts/donut.tsx`,
`_dashboard/charts/top-bars.tsx`, `_dashboard/kpi-strip.tsx`, `_dashboard/heatmap.tsx`,
`_dashboard/session-stats.tsx`, `_dashboard/attention-panel.tsx`,
`_dashboard/dashboard-insights.tsx`.
**Modify:** `src/lib/dashboard/insights.ts` (helpers + getInsights), `insights.test.ts`
(new cases), `src/app/(app)/page.tsx` (fetch + render), `src/app/globals.css` (styles),
`package.json` (recharts).
**Delete:** `_dashboard/insights-panel.tsx` (replaced by `dashboard-insights.tsx` + pieces).
