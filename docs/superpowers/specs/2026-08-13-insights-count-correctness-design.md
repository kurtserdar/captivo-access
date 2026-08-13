# Insights — Count Correctness & Perf — Design

**Status:** Approved (brainstorm 2026-08-13). Decision: keep Insights (option B); rank by days-active; include the SQL-aggregation perf cleanup.
**Backlog:** punch-list #13.
**Ships as:** v0.55.0 (manager only; no schema).

## Problem

`AuditEvent` is a **per-HTTP-request** access log — `dataplane/browserproxy.go:387`
enqueues one `ALLOW` row for every proxied request (assets, XHR, navigations). A
single web session writes hundreds–thousands of rows. Every Insights metric built
on `ALLOW` counts therefore measures *request chattiness*, not access:

- "Access — 30 days" trend = allowed **requests**/day.
- Top resources / Top vendors = ranked by **request volume** (a heavy SPA outranks a busy admin).
- Access type mix (web vs remote) = HTTP is chatty, so **web always dominates** regardless of real usage.

`SessionRecording` is not a usable denominator — recording is gated by
`RECORDING_ENABLED` + a per-site `recordSessions` toggle, so it under-counts when
recording is off.

Secondary problem: `getInsights()` loads **every** audit row for 30 days into
Node memory (`db.auditEvent.findMany` with no limit) to count them — slow / OOM on
a busy server.

## Fix — honest units, computed in SQL

Re-base the misleading metrics on units that mean "access," and push the counting
into the database so raw rows are never loaded. `AuditEvent.timestamp` is a
`timestamp` (no tz) storing UTC, so `to_char("timestamp",'YYYY-MM-DD')` and
`EXTRACT(DOW|HOUR FROM "timestamp")` bucket by UTC exactly as today's
`getUTC*`/`toISOString` logic does — no timezone handling needed.

**Metric mapping:**

| Card | Was | Now |
|---|---|---|
| "Access — 30 days" trend | allowed requests/day (stacked) | **Active vendors — 30 days**: `allow` = distinct vendors with an ALLOW that day, `deny` = distinct vendors with a DENY that day. **Grouped, not stacked** (populations overlap, don't sum). Legend "Accessed" / "Blocked". |
| Top resources | ALLOW request count per site | **distinct active days** per `siteId` (ALLOW), top 5 — subtitle "days active" |
| Top vendors | ALLOW request count per user | **distinct active days** per `userId` (ALLOW), top 5 — subtitle "days active" |
| Access type mix | ALLOW request count web/remote | **distinct (userId, siteId) pairs** per type (join `Site.accessMode`); GATEWAY → remote, else web |
| Deny reasons donut | DENY count by reason | **unchanged meaning** (each DENY = a blocked attempt), now via SQL group-by |
| Heatmap | request volume by hour | **unchanged data, relabel "Traffic by hour"** — honest as an activity map |
| KPIs, session-stats, attention, expiring, active-sessions, ipFlags, topDenied | — | **unchanged meaning**; the audit-derived ones move to SQL |

`activeVendors` (already correct: distinct vendors) stays: `count` = 30-day
`COUNT(DISTINCT userId)` (ALLOW); `series` = the same per-day distinct-vendor
counts that feed the trend `allow` column (single source, no double compute).

## Data layer — `src/lib/dashboard/insights.ts`

`getInsights(now = new Date())` no longer calls `db.auditEvent.findMany`. It runs
these aggregation queries (all `WHERE "timestamp" >= since`, `since = now − 30d`):

1. **Vendors/day** — `$queryRaw`: `to_char("timestamp",'YYYY-MM-DD') AS day, decision, COUNT(DISTINCT "userId") AS n … WHERE "userId" IS NOT NULL GROUP BY day, decision`. Split into allow/deny day-count arrays.
2. **Total distinct vendors** — `COUNT(DISTINCT "userId") WHERE decision='ALLOW' AND "userId" IS NOT NULL`.
3. **Top resources** — `"siteId", MAX("siteName") AS label, COUNT(DISTINCT to_char("timestamp",'YYYY-MM-DD')) AS n WHERE decision='ALLOW' AND "siteId" IS NOT NULL GROUP BY "siteId" ORDER BY n DESC LIMIT 5`.
4. **Top vendors** — same with `"userId"` / `MAX("userEmail")`.
5. **Type mix** — `s."accessMode", COUNT(DISTINCT ("a"."userId","a"."siteId")) AS n FROM "AuditEvent" a JOIN "Site" s ON s.id = a."siteId" WHERE a.decision='ALLOW' AND a."userId" IS NOT NULL GROUP BY s."accessMode"`.
6. **Deny reasons** — `COALESCE("reason",'unspecified') AS reason, COUNT(*) AS n WHERE decision='DENY' GROUP BY reason ORDER BY n DESC` (few distinct reasons — no LIMIT; the transformer sums total then takes top 5).
7. **Heatmap** — `EXTRACT(DOW FROM "timestamp")::int AS dow, EXTRACT(HOUR FROM "timestamp")::int AS hour, COUNT(*) AS n GROUP BY dow, hour` (≤168 rows).
8. **IP flags** — `"userEmail", COUNT(DISTINCT "clientIp") AS n WHERE "userEmail" IS NOT NULL AND "clientIp" IS NOT NULL GROUP BY "userEmail" HAVING COUNT(DISTINCT "clientIp") >= 3 ORDER BY n DESC` (all decisions, matching current behaviour).
9. **Top denied** — `"userEmail", COUNT(*) AS n WHERE decision='DENY' AND "userEmail" IS NOT NULL GROUP BY "userEmail" ORDER BY n DESC LIMIT 3`.

The existing non-audit queries stay: `expiring` grants, `expiringCount`,
`listActiveSessions`, and `sessionRecording` for `sessionStats`.

**BigInt:** Postgres `COUNT()` comes back from `$queryRaw` as JS `BigInt` — every
transformer converts count fields with `Number()`.

**Pure transformers** (unit-tested; fed the small aggregate arrays, not raw rows):

```ts
type DailyCount = { day: string; count: number };
type HourCell = { dow: number; hour: number; count: number };

zeroFillDays(now: Date, days = 30): string[]                          // UTC YYYY-MM-DD, oldest→newest
buildTrend(allow: DailyCount[], deny: DailyCount[], now, days = 30): TrendDay[]
buildHeatmap(cells: HourCell[]): { grid: number[][]; max: number }
toRefCounts(rows: { id: string; label: string | null; count: number }[]): RefCount[]  // label fallback → id
buildTypeMix(rows: { accessMode: string; count: number }[]): { web: number; remote: number }
toDenyReasons(rows: { reason: string; count: number }[], limit: number): { total: number; reasons: Labeled[] }
toIpFlags(rows: { userEmail: string; ipCount: number }[]): IpFlag[]   // pass-through shape guard
seriesFor(days: string[], allow: DailyCount[]): number[]             // activeVendors.series
```

The old row-scanning helpers (`topBy`, `topRef`, `denyReasons(rows)`,
`ipFlags(rows)`, `activeVendors(rows)`, `typeMix(rows)`, the `AuditRow` type) are
**removed** — replaced by the transformers above. `sessionStats(recs)` stays
unchanged. The exported `Insights` interface is **unchanged** (same fields/shape),
so `DashboardInsights`, `KpiStrip`, and `AttentionPanel` need no prop changes.

## View layer

**`src/app/(app)/_dashboard/dashboard-insights.tsx`** — retitle cards only:
- `c-access`: `<h2>Access — 30 days</h2>` + sub `allowed vs denied` → `<h2>Active vendors — 30 days</h2>` + sub `accessed vs blocked`.
- `c-heat` heatmap: title becomes **"Traffic by hour"** (set in the Heatmap component or the card head — see note).
- `c-topr` / `c-topv`: add sub `days active` under the `<h2>`.

**`src/app/(app)/_dashboard/charts/access-trend.tsx`** — remove `stackId="a"` from
both `<Bar>` (grouped, not stacked); rename `name="Allowed"` → `"Accessed"`,
`name="Denied"` → `"Blocked"`. The `total`-based empty guard stays (0 accessed and
0 blocked → "No access in the last 30 days."). The day-drill click stays.

**Heatmap title:** if the `Heatmap` component renders its own heading, change it to
"Traffic by hour"; otherwise add the `<h2>` in the `c-heat` card head in
`dashboard-insights.tsx`. (Implementer picks whichever matches the component.)

**`src/app/(app)/admin/insights/page.tsx`** — remove the redundant bottom that
duplicates Console: delete the `<div className="dash-cols">` block with
`<SiteHealthPanel>` + `<RecentActivityPanel>`, and their now-unused imports and the
`getSiteHealth()` / `getRecentActivity()` calls from the `Promise.all`. Keep
`getDashboardStats()` and `getInsights()`. **Do not** delete the lib functions
`getSiteHealth` / `getRecentActivity` — Console still uses them.

## Non-goals / guardrails

- **No schema change, no dataplane/connector change.** Manager only.
- Don't change what an audit row *is* (still per-request) — only how Insights
  aggregates it.
- Deny/heatmap semantics unchanged (only relabelled/moved to SQL).
- The `Insights` interface shape is frozen — no downstream prop churn.

## Testing

- **`src/lib/dashboard/insights.test.ts`** — rewrite for the new transformer
  signatures (aggregate-array inputs), covering:
  - `zeroFillDays`: 30 UTC keys oldest→newest, boundary day.
  - `buildTrend`: maps allow/deny `DailyCount[]` onto zero-filled days; days with no data → 0; out-of-window keys ignored.
  - `buildHeatmap`: fills the right `dow×hour` cell and reports `max`.
  - `toRefCounts`: label fallback to id; BigInt→Number already applied by caller (pass numbers).
  - `buildTypeMix`: GATEWAY→remote, others→web, summed.
  - `toDenyReasons`: total = sum of all rows; top-`limit` slice; `unspecified` passthrough.
  - `seriesFor`: per-day distinct-vendor series aligned to `zeroFillDays`.
  - `sessionStats`: unchanged (keep existing cases).
- `pnpm build` — typechecks the rewritten module + views.
- `pnpm test` — full suite green.
- Gate A (after deploy): `/admin/insights` — headline card reads "Active vendors —
  30 days" with grouped Accessed/Blocked bars; top resources/vendors show "days
  active"; type mix is not web-dominated by chattiness; heatmap titled "Traffic by
  hour"; SiteHealth/RecentActivity panels gone; page loads quickly (no full-table
  scan). Numbers sanity-check against `/admin/audit` distinct users.

## Deploy

**v0.55.0**, manager only. Bump the manager tag, `docker compose up -d access-manager`,
verify `/login` 200 + `APP_VERSION`, then Gate A, then English `gh release edit` note.
