# Dashboard Insights — analytics on the manager home

**Status:** approved design (2026-08-11)
**Repo:** `/opt/captivo-access` (public OSS, English-only)

## Goal

Add a visual **Insights** section below the existing stat cards on the admin home
(`/`), turning the audit trail into at-a-glance security/ops analytics for a
Zero-Trust vendor-access product: access trend, an access heatmap, top
resources/vendors, and an attention panel (denials, IP-diversity flags,
expiring grants, active sessions). Fixed **last-30-days** window.

## Approach

- **One query, pure aggregation.** Fetch the last 30 days of `AuditEvent` rows
  (only the columns needed) once, plus expiring grants and active sessions, then
  compute every metric with **pure, unit-tested JS helpers** — no raw SQL, no new
  query pattern. Audit volume for a vendor-access tool is moderate; the fetch is
  bounded by `timestamp >= now-30d` (indexed) and selects six small columns.
- **Hand-rolled inline SVG**, server-rendered. No chart library (the strict CSP
  forbids external scripts, and the dashboard is a server component). Bars,
  spar-style day columns, and a heatmap grid are plain `<svg>`/`<rect>` — matching
  the existing no-dependency, icon-as-inline-SVG style of `stat-cards.tsx`.
- **Admin only.** The Insights section renders only on the existing admin
  dashboard branch (non-admins never reach it).

## Data available

`AuditEvent` (`timestamp`, `userEmail`, `siteName`, `decision` ALLOW/DENY,
`clientIp`, `reason`; indexed on `timestamp`), `AccessGrant` (`endsAt`, `status`),
and the data-plane's `listActiveSessions()` (already built for live view;
fail-soft to `[]`). Durations/recordings are intentionally out of scope.

## Components

### 1. Aggregation (`src/lib/dashboard/insights.ts`, new)

Pure helpers (exported for tests) + one async `getInsights()`.

Types:

```ts
export interface TrendDay { date: string; allow: number; deny: number } // date = YYYY-MM-DD (UTC)
export interface Labeled { label: string; count: number }
export interface IpFlag { userEmail: string; ipCount: number }
export interface Insights {
  trend: TrendDay[];              // 30 entries, oldest→newest, zero-filled
  heatmap: { grid: number[][]; max: number }; // grid[dow 0=Sun..6][hour 0..23]
  topResources: Labeled[];        // ALLOW, by siteName, top 5
  topVendors: Labeled[];          // ALLOW, by userEmail, top 5
  deny: { total: number; reasons: Labeled[] };   // DENY, top 5 reasons
  ipFlags: IpFlag[];              // vendors with >= IP_FLAG_THRESHOLD distinct IPs
  expiring: { count: number; soonest: { userEmail: string; siteName: string; endsAt: string }[] }; // next 7 days, top 5
  activeSessions: { count: number; longestStartedAt: string | null };
}

export const IP_FLAG_THRESHOLD = 3;
```

Minimal event shape the helpers consume:

```ts
export interface AuditRow { timestamp: Date; decision: "ALLOW" | "DENY"; siteName: string | null; userEmail: string | null; clientIp: string | null; reason: string | null }
```

Pure helpers (all take a fixed `now` where time-relative, so tests are
deterministic; all bucket in **UTC**):

- `buildTrend(rows: AuditRow[], now: Date, days = 30): TrendDay[]` — bucket by
  UTC calendar day, count allow/deny, zero-fill every day in the window,
  oldest→newest.
- `buildHeatmap(rows: AuditRow[]): { grid: number[][]; max: number }` — 7×24
  counts by `getUTCDay()`×`getUTCHours()`, plus the max cell (for colour scaling).
- `topBy(rows: AuditRow[], field: "siteName" | "userEmail", limit: number): Labeled[]`
  — ALLOW only, non-null field, count, desc, top `limit`.
- `denyReasons(rows: AuditRow[], limit: number): { total: number; reasons: Labeled[] }`
  — DENY only, group by `reason` (null → "unspecified"), total + top `limit`.
- `ipFlags(rows: AuditRow[], threshold: number): IpFlag[]` — per `userEmail`,
  count of distinct non-null `clientIp`; keep those `>= threshold`, desc.

`getInsights()` (async, server):
1. `const since = new Date(now - 30d)`.
2. Fetch rows: `db.auditEvent.findMany({ where: { timestamp: { gte: since } }, select: { timestamp: true, decision: true, siteName: true, userEmail: true, clientIp: true, reason: true } })`.
3. Fetch expiring: `db.accessGrant.findMany({ where: { status: "ACTIVE", endsAt: { gte: now, lte: now+7d } }, select: { endsAt, user: { select: { email } }, site: { select: { name } } }, orderBy: { endsAt: "asc" }, take: 5 })` + a `count` with the same where.
4. `active = await listActiveSessions()` (fail-soft); `count = active.length`,
   `longestStartedAt = min(startedAt)` or null.
5. Run the pure helpers and return `Insights`.

### 2. UI (`src/app/(app)/_dashboard/insights-panel.tsx`, new)

A server component `InsightsPanel({ data }: { data: Insights })` laid out as a
section of cards (reusing `.card` / `.card-head`), with small internal
components — all inline SVG, no client JS:

- **`TrendChart`** — a row of 30 day-columns; each column two stacked/side bars
  (allow = `--ok` teal, deny = `--danger` red), height ∝ count / max. A legend and
  the 30-day total. Empty state: "No access in the last 30 days."
- **`Heatmap`** — a 7×24 grid of `<rect>`; fill opacity = `count / max`; row
  labels Sun–Sat, sparse hour ticks (0/6/12/18). A note that hours are UTC. This
  is the "when do vendors connect / off-hours" view.
- **`TopList`** — a horizontal-bar list (label + a `%`-width bar + count), used
  twice: **Top resources** and **Top vendors**. Empty state per list.
- **`AttentionPanel`** — a compact card with four blocks:
  - **Denials (30d):** total + the top deny reasons as `reason · count` rows.
  - **IP-diversity flags:** each flagged vendor as `email · N IPs` (a warn pill);
    "None" when empty.
  - **Grants expiring (7d):** count + the soonest few (`email → site · in Nd`).
  - **Active sessions:** count now + "longest: Xh Ym" (from `longestStartedAt`);
    "data-plane unavailable" is simply `0` (fail-soft).

Layout: a `.insights-grid` — trend full-width on top, then a two-column row
(heatmap + attention), then a two-column row (top resources + top vendors). It
degrades to one column on narrow screens.

### 3. Home page (`src/app/(app)/page.tsx`)

Add `getInsights()` to the existing admin `Promise.all`, and render
`<InsightsPanel data={insights} />` immediately after `<StatCards s={stats} />`
(before the `dash-cols` panels). No other change.

### 4. Styles (`src/app/(app)/globals.css`)

Add `.insights-grid` (responsive grid), `.trend-*`, `.heatmap-*`, `.toplist-*`,
and `.attention-*` classes (bars, cells, rows). Colours reuse the existing
`--ok` / `--danger` / `--warn` tokens so both themes work.

## Data flow

`page.tsx` (admin) → `getInsights()` (one audit fetch + grants + active) → pure
helpers shape the data → `InsightsPanel` renders inline SVG. All server-side;
nothing ships to the client but static SVG/HTML.

## Error handling / edge cases

- **No data** (fresh install) → each chart/list shows its empty state; heatmap
  renders all-empty cells.
- **Data-plane offline** → `listActiveSessions()` returns `[]` → active sessions
  shows `0` (no crash).
- **Null fields** — `siteName`/`userEmail`/`clientIp`/`reason` may be null;
  helpers skip nulls (or map `reason` null → "unspecified").
- **UTC bucketing** — trend days and heatmap hours are UTC; noted in the UI. Per-
  tenant timezone is a later refinement, out of scope.
- **Volume** — the fetch is `timestamp >= now-30d` (indexed) selecting six
  columns. Adequate for vendor-access volumes; if a deployment's 30-day audit
  count ever makes this heavy, the helpers can move to SQL aggregation without
  changing the UI (out of scope now).

## Non-goals

- No time-window selector (fixed 30 days), no CSV/PDF export, no per-tenant TZ.
- No average session duration / recording-coverage / protocol-mix cards (deferred).
- No new dependency; no schema change; no data-plane/connector change.

## Capability gating / config

- Manager-only, admin-only. No new env, **no schema change → no `access-migrate`**.

## Testing

**TS (vitest, `src/lib/dashboard/insights.test.ts`):**
- `buildTrend`: zero-fills all 30 days; buckets allow/deny into the right UTC day;
  oldest→newest order; a fixed `now` + a handful of rows across days.
- `buildHeatmap`: places a row into the correct `[dow][hour]` cell (UTC) and
  reports `max`.
- `topBy`: ALLOW-only, ignores nulls, sorts desc, respects `limit`.
- `denyReasons`: DENY-only, groups by reason, null → "unspecified", total + top N.
- `ipFlags`: distinct IPs per vendor, threshold filter, desc.

**Gate A (live, operator):**
- On the admin home, below the stat cards, the Insights section renders: a 30-day
  allow/deny trend, a day×hour heatmap that lights up where access happened, top
  resources + top vendors, and the attention panel (denials, any IP flags,
  grants expiring in 7 days, active sessions). A fresh install shows tasteful
  empty states.

## Deploy notes

- Manager-only → bump `access-manager`. No migrate, no data-plane/connector change.
- English-only strings + GitHub Release note.

## File map

**Create:** `src/lib/dashboard/insights.ts` (+ `insights.test.ts`),
`src/app/(app)/_dashboard/insights-panel.tsx`.
**Modify:** `src/app/(app)/page.tsx` (fetch + render), `src/app/(app)/globals.css`
(insights styles).
