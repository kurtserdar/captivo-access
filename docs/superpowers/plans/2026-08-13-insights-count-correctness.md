# Insights Count-Correctness & Perf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Insights page count *access* (distinct vendors / days-active), not raw HTTP requests, and compute it with small SQL aggregations instead of loading every audit row into memory.

**Architecture:** `src/lib/dashboard/insights.ts` is rewritten: `getInsights()` runs ~9 SQL aggregation queries (`$queryRaw` for `COUNT(DISTINCT …)`) and feeds small pure transformer functions that produce the existing `Insights` shape (frozen). The view layer only retitles cards, un-stacks the trend chart, and drops two Console-duplicating panels.

**Tech Stack:** Next.js (App Router), Prisma 7 (`$queryRaw`, Postgres), TypeScript, vitest, Recharts.

## Global Constraints

- **English only** — code, comments, commit messages. **No Claude signature.**
- **Manager-only**, no schema, no dataplane/connector change. Ships as **v0.55.0**.
- **`Insights` interface shape is frozen** — same fields/types, so `DashboardInsights`/`KpiStrip`/`AttentionPanel` need no prop changes. Only the *meaning* of numbers and card titles change.
- **UTC bucketing:** `AuditEvent.timestamp` is `timestamp` (no tz) storing UTC; use `to_char("timestamp",'YYYY-MM-DD')` and `EXTRACT(DOW|HOUR FROM "timestamp")` — no timezone handling.
- **BigInt:** Postgres `COUNT()` returns JS `BigInt` from `$queryRaw`; convert every count with `Number()` before it reaches a transformer.
- Prisma tables/columns are unmapped: `"AuditEvent"`, `"Site"`, camelCase columns quoted (`"userId"`, `"siteId"`, `"siteName"`, `"userEmail"`, `"clientIp"`, `"decision"`, `"reason"`, `"accessMode"`).
- Verify with `pnpm test` and `pnpm build` (no `grep` pipe — capture the exit code).

---

### Task 1: Rewrite the insights data layer (transformers + SQL) + tests

**Files:**
- Modify: `src/lib/dashboard/insights.ts` (whole file)
- Modify: `src/lib/dashboard/insights.test.ts` (whole file)

**Interfaces:**
- Consumes: `db` (`@/lib/db`), `listActiveSessions` (`@/lib/dataplane/client`).
- Produces (pure, exported): `zeroFillDays(now, days?)`, `buildTrend(allow, deny, now, days?)`, `seriesFor(days, allow)`, `buildHeatmap(cells)`, `toRefCounts(rows)`, `buildTypeMix(rows)`, `toDenyReasons(rows, limit)`, `toIpFlags(rows)`, `sessionStats(recs)` (unchanged); types `DailyCount`, `HourCell`, `TrendDay`, `Labeled`, `IpFlag`, `RefCount`, `Insights`; `IP_FLAG_THRESHOLD`; `getInsights(now?)`.
- Removed: `AuditRow`, `topBy`, `topRef`, the old `buildTrend(rows,…)`, `buildHeatmap(rows)`, `denyReasons(rows,…)`, `ipFlags(rows,…)`, `activeVendors(rows,…)`, `typeMix(rows,…)`.

- [ ] **Step 1: Rewrite the test file**

Replace the whole `src/lib/dashboard/insights.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  zeroFillDays, buildTrend, seriesFor, buildHeatmap,
  toRefCounts, buildTypeMix, toDenyReasons, toIpFlags, sessionStats,
} from "./insights";

describe("zeroFillDays", () => {
  it("returns `days` UTC keys oldest→newest ending today", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const keys = zeroFillDays(now, 30);
    expect(keys.length).toBe(30);
    expect(keys[29]).toBe("2026-08-11");
    expect(keys[28]).toBe("2026-08-10");
    expect(keys[0]).toBe("2026-07-13");
  });
});

describe("buildTrend", () => {
  it("maps allow/deny distinct-vendor day counts onto the zero-filled window", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const allow = [{ day: "2026-08-11", count: 3 }, { day: "2026-08-10", count: 1 }, { day: "2000-01-01", count: 9 }];
    const deny = [{ day: "2026-08-11", count: 2 }];
    const t = buildTrend(allow, deny, now);
    expect(t.length).toBe(30);
    expect(t[29]).toEqual({ date: "2026-08-11", allow: 3, deny: 2 });
    expect(t[28]).toEqual({ date: "2026-08-10", allow: 1, deny: 0 });
    expect(t[27]).toEqual({ date: "2026-08-09", allow: 0, deny: 0 }); // no data → 0
    expect(t.some((d) => d.allow === 9)).toBe(false); // out-of-window key ignored
  });
});

describe("seriesFor", () => {
  it("aligns allow day-counts to the given day keys", () => {
    const days = ["2026-08-09", "2026-08-10", "2026-08-11"];
    const allow = [{ day: "2026-08-11", count: 3 }, { day: "2026-08-09", count: 5 }];
    expect(seriesFor(days, allow)).toEqual([5, 0, 3]);
  });
});

describe("buildHeatmap", () => {
  it("fills the right dow×hour cell and reports max, skipping out-of-range", () => {
    const { grid, max } = buildHeatmap([
      { dow: 2, hour: 9, count: 5 },
      { dow: 0, hour: 23, count: 8 },
      { dow: 9, hour: 0, count: 99 }, // out of range → skipped
    ]);
    expect(grid[2][9]).toBe(5);
    expect(grid[0][23]).toBe(8);
    expect(max).toBe(8);
  });
});

describe("toRefCounts", () => {
  it("maps rows and falls back label→id", () => {
    expect(toRefCounts([{ id: "s1", label: "App", count: 4 }, { id: "s2", label: null, count: 2 }]))
      .toEqual([{ id: "s1", label: "App", count: 4 }, { id: "s2", label: "s2", count: 2 }]);
  });
});

describe("buildTypeMix", () => {
  it("sums GATEWAY→remote and everything else→web", () => {
    expect(buildTypeMix([{ accessMode: "GATEWAY", count: 3 }, { accessMode: "TRANSPARENT", count: 5 }]))
      .toEqual({ web: 5, remote: 3 });
  });
});

describe("toDenyReasons", () => {
  it("totals all rows then returns the top `limit`", () => {
    const rows = [
      { reason: "not_a_member", count: 5 },
      { reason: "expired", count: 3 },
      { reason: "unspecified", count: 1 },
    ];
    const out = toDenyReasons(rows, 2);
    expect(out.total).toBe(9);
    expect(out.reasons).toEqual([{ label: "not_a_member", count: 5 }, { label: "expired", count: 3 }]);
  });
});

describe("toIpFlags", () => {
  it("passes through the SQL-filtered rows", () => {
    expect(toIpFlags([{ userEmail: "a@x.io", ipCount: 4 }])).toEqual([{ userEmail: "a@x.io", ipCount: 4 }]);
  });
});

describe("sessionStats", () => {
  it("returns zeros for no recordings", () => {
    expect(sessionStats([])).toEqual({ recordings: 0, totalHours: 0, avgMinutes: 0 });
  });
  it("computes count, total hours, average minutes", () => {
    const s = sessionStats([
      { startedAt: new Date("2026-08-11T10:00:00Z"), lastEventAt: new Date("2026-08-11T11:00:00Z") }, // 60m
      { startedAt: new Date("2026-08-11T10:00:00Z"), lastEventAt: new Date("2026-08-11T10:30:00Z") }, // 30m
    ]);
    expect(s.recordings).toBe(2);
    expect(s.totalHours).toBe(2); // 90m → round(1.5h)=2
    expect(s.avgMinutes).toBe(45);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: FAIL — `zeroFillDays`/`seriesFor`/`toRefCounts`/`buildTypeMix`/`toDenyReasons`/`toIpFlags` are not exported yet, and `buildTrend`/`buildHeatmap` have the old signatures.

- [ ] **Step 3: Rewrite `insights.ts`**

Replace the whole `src/lib/dashboard/insights.ts` with:

```ts
import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/dataplane/client";

export interface TrendDay { date: string; allow: number; deny: number }
export interface Labeled { label: string; count: number }
export interface IpFlag { userEmail: string; ipCount: number }
export interface RefCount { id: string; label: string; count: number }

export type DailyCount = { day: string; count: number };
export type HourCell = { dow: number; hour: number; count: number };

export const IP_FLAG_THRESHOLD = 3;

// UTC YYYY-MM-DD keys, oldest→newest, ending on `now`'s UTC day.
export function zeroFillDays(now: Date, days = 30): string[] {
  const keys: string[] = [];
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

// Distinct-vendor allow/deny day-counts mapped onto the zero-filled window.
export function buildTrend(allow: DailyCount[], deny: DailyCount[], now: Date, days = 30): TrendDay[] {
  const keys = zeroFillDays(now, days);
  const a = new Map(allow.map((r) => [r.day, r.count]));
  const d = new Map(deny.map((r) => [r.day, r.count]));
  return keys.map((k) => ({ date: k, allow: a.get(k) ?? 0, deny: d.get(k) ?? 0 }));
}

// Per-day allow (distinct vendors) series aligned to the given day keys.
export function seriesFor(days: string[], allow: DailyCount[]): number[] {
  const a = new Map(allow.map((r) => [r.day, r.count]));
  return days.map((k) => a.get(k) ?? 0);
}

// 7×24 grid from (dow,hour,count) cells; out-of-range cells skipped; reports max.
export function buildHeatmap(cells: HourCell[]): { grid: number[][]; max: number } {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const c of cells) {
    if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue;
    grid[c.dow][c.hour] = c.count;
    if (c.count > max) max = c.count;
  }
  return { grid, max };
}

// id/label/count rows (already sorted+limited by SQL) → RefCount; label falls back to id.
export function toRefCounts(rows: { id: string; label: string | null; count: number }[]): RefCount[] {
  return rows.map((r) => ({ id: r.id, label: r.label ?? r.id, count: r.count }));
}

// accessMode/count rows → web/remote totals (GATEWAY = remote, else web).
export function buildTypeMix(rows: { accessMode: string; count: number }[]): { web: number; remote: number } {
  let web = 0, remote = 0;
  for (const r of rows) {
    if (r.accessMode === "GATEWAY") remote += r.count;
    else web += r.count;
  }
  return { web, remote };
}

// All DENY reason/count rows → total (sum of all) + top `limit` as Labeled.
export function toDenyReasons(rows: { reason: string; count: number }[], limit: number): { total: number; reasons: Labeled[] } {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const reasons = [...rows]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((r) => ({ label: r.reason, count: r.count }));
  return { total, reasons };
}

// Pass-through shape guard (SQL already applied the threshold + ordering).
export function toIpFlags(rows: { userEmail: string; ipCount: number }[]): IpFlag[] {
  return rows.map((r) => ({ userEmail: r.userEmail, ipCount: r.ipCount }));
}

// Recording volume in the window: count, total hours, average minutes.
export function sessionStats(recs: { startedAt: Date; lastEventAt: Date }[]): { recordings: number; totalHours: number; avgMinutes: number } {
  if (recs.length === 0) return { recordings: 0, totalHours: 0, avgMinutes: 0 };
  let totalMs = 0;
  for (const r of recs) totalMs += Math.max(0, r.lastEventAt.getTime() - r.startedAt.getTime());
  return {
    recordings: recs.length,
    totalHours: Math.round(totalMs / 3_600_000),
    avgMinutes: Math.round(totalMs / recs.length / 60_000),
  };
}

export interface Insights {
  trend: TrendDay[];
  heatmap: { grid: number[][]; max: number };
  topResources: RefCount[];
  topVendors: RefCount[];
  deny: { total: number; reasons: Labeled[] };
  ipFlags: IpFlag[];
  expiring: { count: number; soonest: { userEmail: string; siteName: string; endsAt: string }[] };
  activeSessions: { count: number; longestStartedAt: string | null };
  activeVendors: { count: number; series: number[] };
  typeMix: { web: number; remote: number };
  sessionStats: { recordings: number; totalHours: number; avgMinutes: number };
  topDenied: Labeled[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getInsights(now = new Date()): Promise<Insights> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const in7d = new Date(now.getTime() + 7 * DAY_MS);
  const expiringWhere = { status: "ACTIVE" as const, endsAt: { gte: now, lte: in7d } };

  const [
    vendorsByDay, totalVendorsRows, topResRows, topVenRows, typeMixRows,
    denyReasonRows, heatmapRows, ipFlagRows, topDeniedRows,
    expiringRows, expiringCount, active, recordings,
  ] = await Promise.all([
    db.$queryRaw<{ day: string; decision: string; n: bigint }[]>`
      SELECT to_char("timestamp", 'YYYY-MM-DD') AS day, "decision"::text AS decision, COUNT(DISTINCT "userId") AS n
      FROM "AuditEvent"
      WHERE "timestamp" >= ${since} AND "userId" IS NOT NULL
      GROUP BY day, "decision"`,
    db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT "userId") AS n FROM "AuditEvent"
      WHERE "timestamp" >= ${since} AND "decision" = 'ALLOW' AND "userId" IS NOT NULL`,
    db.$queryRaw<{ id: string; label: string | null; n: bigint }[]>`
      SELECT "siteId" AS id, MAX("siteName") AS label, COUNT(DISTINCT to_char("timestamp", 'YYYY-MM-DD')) AS n
      FROM "AuditEvent"
      WHERE "timestamp" >= ${since} AND "decision" = 'ALLOW' AND "siteId" IS NOT NULL
      GROUP BY "siteId" ORDER BY n DESC LIMIT 5`,
    db.$queryRaw<{ id: string; label: string | null; n: bigint }[]>`
      SELECT "userId" AS id, MAX("userEmail") AS label, COUNT(DISTINCT to_char("timestamp", 'YYYY-MM-DD')) AS n
      FROM "AuditEvent"
      WHERE "timestamp" >= ${since} AND "decision" = 'ALLOW' AND "userId" IS NOT NULL
      GROUP BY "userId" ORDER BY n DESC LIMIT 5`,
    db.$queryRaw<{ accessMode: string; n: bigint }[]>`
      SELECT s."accessMode"::text AS "accessMode", COUNT(DISTINCT ("a"."userId", "a"."siteId")) AS n
      FROM "AuditEvent" a JOIN "Site" s ON s."id" = "a"."siteId"
      WHERE "a"."timestamp" >= ${since} AND "a"."decision" = 'ALLOW' AND "a"."userId" IS NOT NULL
      GROUP BY s."accessMode"`,
    db.$queryRaw<{ reason: string | null; n: bigint }[]>`
      SELECT COALESCE("reason", 'unspecified') AS reason, COUNT(*) AS n
      FROM "AuditEvent"
      WHERE "timestamp" >= ${since} AND "decision" = 'DENY'
      GROUP BY reason ORDER BY n DESC`,
    db.$queryRaw<{ dow: number; hour: number; n: bigint }[]>`
      SELECT EXTRACT(DOW FROM "timestamp")::int AS dow, EXTRACT(HOUR FROM "timestamp")::int AS hour, COUNT(*) AS n
      FROM "AuditEvent"
      WHERE "timestamp" >= ${since}
      GROUP BY dow, hour`,
    db.$queryRaw<{ userEmail: string; n: bigint }[]>`
      SELECT "userEmail", COUNT(DISTINCT "clientIp") AS n
      FROM "AuditEvent"
      WHERE "timestamp" >= ${since} AND "userEmail" IS NOT NULL AND "clientIp" IS NOT NULL
      GROUP BY "userEmail" HAVING COUNT(DISTINCT "clientIp") >= ${IP_FLAG_THRESHOLD}
      ORDER BY n DESC`,
    db.$queryRaw<{ userEmail: string; n: bigint }[]>`
      SELECT "userEmail", COUNT(*) AS n
      FROM "AuditEvent"
      WHERE "timestamp" >= ${since} AND "decision" = 'DENY' AND "userEmail" IS NOT NULL
      GROUP BY "userEmail" ORDER BY n DESC LIMIT 3`,
    db.accessGrant.findMany({
      where: expiringWhere,
      select: { endsAt: true, user: { select: { email: true } }, site: { select: { name: true } } },
      orderBy: { endsAt: "asc" },
      take: 5,
    }),
    db.accessGrant.count({ where: expiringWhere }),
    listActiveSessions(),
    db.sessionRecording.findMany({ where: { startedAt: { gte: since } }, select: { startedAt: true, lastEventAt: true } }),
  ]);

  const days = zeroFillDays(now);
  const allowByDay: DailyCount[] = vendorsByDay.filter((r) => r.decision === "ALLOW").map((r) => ({ day: r.day, count: Number(r.n) }));
  const denyByDay: DailyCount[] = vendorsByDay.filter((r) => r.decision === "DENY").map((r) => ({ day: r.day, count: Number(r.n) }));
  const longestStartedAt = active.length ? [...active].map((a) => a.startedAt).sort()[0] : null;

  return {
    trend: buildTrend(allowByDay, denyByDay, now),
    heatmap: buildHeatmap(heatmapRows.map((r) => ({ dow: r.dow, hour: r.hour, count: Number(r.n) }))),
    topResources: toRefCounts(topResRows.map((r) => ({ id: r.id, label: r.label, count: Number(r.n) }))),
    topVendors: toRefCounts(topVenRows.map((r) => ({ id: r.id, label: r.label, count: Number(r.n) }))),
    deny: toDenyReasons(denyReasonRows.map((r) => ({ reason: r.reason ?? "unspecified", count: Number(r.n) })), 5),
    ipFlags: toIpFlags(ipFlagRows.map((r) => ({ userEmail: r.userEmail, ipCount: Number(r.n) }))),
    expiring: {
      count: expiringCount,
      soonest: expiringRows.map((g) => ({
        userEmail: g.user.email ?? "—",
        siteName: g.site.name,
        endsAt: (g.endsAt as Date).toISOString(),
      })),
    },
    activeSessions: { count: active.length, longestStartedAt },
    activeVendors: { count: totalVendorsRows.length ? Number(totalVendorsRows[0].n) : 0, series: seriesFor(days, allowByDay) },
    typeMix: buildTypeMix(typeMixRows.map((r) => ({ accessMode: r.accessMode, count: Number(r.n) }))),
    sessionStats: sessionStats(recordings),
    topDenied: topDeniedRows.map((r) => ({ label: r.userEmail, count: Number(r.n) })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Verify the build**

Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?`
Expected: `EXIT=0` — no other file imported the removed helpers (`topBy`/`topRef`/`AuditRow`). If the build reports an import of a removed symbol, that file must switch to the new API; there are none expected (only `insights.ts` used them internally).

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/insights.ts src/lib/dashboard/insights.test.ts
git commit -m "feat(insights): count access by distinct vendors/days-active via SQL aggregation"
```

---

### Task 2: View — retitle cards, un-stack trend, drop redundant panels

**Files:**
- Modify: `src/app/(app)/_dashboard/dashboard-insights.tsx`
- Modify: `src/app/(app)/_dashboard/heatmap.tsx`
- Modify: `src/app/(app)/_dashboard/charts/access-trend.tsx`
- Modify: `src/app/(app)/admin/insights/page.tsx`

**Interfaces:**
- Consumes: the frozen `Insights` shape (Task 1). No new exports.

- [ ] **Step 1: Retitle the access + top cards**

In `src/app/(app)/_dashboard/dashboard-insights.tsx`, replace the access card head:

```tsx
        <div className="card c-access"><div className="card-head"><div className="ch-title"><h2>Access — 30 days</h2><span className="sub">allowed vs denied</span></div></div><AccessTrend data={insights.trend} /></div>
```

with:

```tsx
        <div className="card c-access"><div className="card-head"><div className="ch-title"><h2>Active vendors — 30 days</h2><span className="sub">accessed vs blocked</span></div></div><AccessTrend data={insights.trend} /></div>
```

Then add a `days active` sub to the two top cards — replace:

```tsx
        <div className="card c-topr"><div className="card-head"><div className="ch-title"><h2>Top resources</h2></div></div><TopBars items={insights.topResources} hrefBase="/admin/audit?siteId=" /></div>
        <div className="card c-topv"><div className="card-head"><div className="ch-title"><h2>Top vendors</h2></div></div><TopBars items={insights.topVendors} hrefBase="/admin/audit?userId=" /></div>
```

with:

```tsx
        <div className="card c-topr"><div className="card-head"><div className="ch-title"><h2>Top resources</h2><span className="sub">days active</span></div></div><TopBars items={insights.topResources} hrefBase="/admin/audit?siteId=" /></div>
        <div className="card c-topv"><div className="card-head"><div className="ch-title"><h2>Top vendors</h2><span className="sub">days active</span></div></div><TopBars items={insights.topVendors} hrefBase="/admin/audit?userId=" /></div>
```

- [ ] **Step 2: Retitle the heatmap**

In `src/app/(app)/_dashboard/heatmap.tsx`, replace:

```tsx
      <div className="card-head"><div className="ch-title"><h2>When vendors connect</h2><span className="sub">day × hour (UTC), last 30 days</span></div></div>
```

with:

```tsx
      <div className="card-head"><div className="ch-title"><h2>Traffic by hour</h2><span className="sub">day × hour (UTC), last 30 days</span></div></div>
```

- [ ] **Step 3: Un-stack the trend + rename its series**

In `src/app/(app)/_dashboard/charts/access-trend.tsx`, replace the two `<Bar>` lines:

```tsx
        <Bar dataKey="allow" name="Allowed" stackId="a" fill="var(--ok)" hide={hidden.allow} activeBar={{ opacity: 0.85 }} />
        <Bar dataKey="deny" name="Denied" stackId="a" fill="var(--danger)" hide={hidden.deny} activeBar={{ opacity: 0.85 }} />
```

with (drop `stackId`, rename):

```tsx
        <Bar dataKey="allow" name="Accessed" fill="var(--ok)" hide={hidden.allow} activeBar={{ opacity: 0.85 }} />
        <Bar dataKey="deny" name="Blocked" fill="var(--danger)" hide={hidden.deny} activeBar={{ opacity: 0.85 }} />
```

(The `total`-based empty guard and the day-drill `onClick` stay unchanged.)

- [ ] **Step 4: Drop the Console-duplicating panels from the Insights page**

In `src/app/(app)/admin/insights/page.tsx`, replace the whole file with:

```tsx
import { requireCapability } from "@/lib/current-user";
import { getDashboardStats } from "@/lib/dashboard/stats";
import { getInsights } from "@/lib/dashboard/insights";
import { DashboardInsights } from "../../_dashboard/dashboard-insights";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  await requireCapability("read_console");
  const [stats, insights] = await Promise.all([getDashboardStats(), getInsights()]);
  return (
    <main>
      <div className="page-head"><div><h1>Insights</h1></div></div>
      <DashboardInsights stats={stats} insights={insights} />
    </main>
  );
}
```

(`getSiteHealth` / `getRecentActivity` and the `SiteHealthPanel` / `RecentActivityPanel`
components are left in place in the codebase — Console still uses them.)

- [ ] **Step 5: Verify build**

Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?`
Expected: `EXIT=0`. No unused-import error (the removed imports were deleted with the file rewrite).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/_dashboard/dashboard-insights.tsx" "src/app/(app)/_dashboard/heatmap.tsx" "src/app/(app)/_dashboard/charts/access-trend.tsx" "src/app/(app)/admin/insights/page.tsx"
git commit -m "feat(insights): retitle cards, group trend bars, drop Console-duplicating panels"
```

---

### Task 3: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test > /tmp/t.log 2>&1; echo EXIT=$?` → `EXIT=0` (new transformer tests + rest of suite).
- [ ] **Step 2: Build** — Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?` → `EXIT=0`.
- [ ] **Step 3: Manual (Gate A, after deploy):**
  1. `/admin/insights` loads fast (no full audit-table scan).
  2. Headline card reads **"Active vendors — 30 days"** with **grouped** (not stacked) Accessed/Blocked bars; toggling a legend series hides it; clicking a day drills into `/admin/audit` for that day.
  3. **Top resources** / **Top vendors** show the "days active" sub and rank by distinct active days (a chatty SPA no longer dominates purely on request volume).
  4. **Access type mix** is not trivially web-dominated — it counts distinct vendor↔resource pairs.
  5. Heatmap titled **"Traffic by hour"**.
  6. The old **Site health** + **Recent activity** panels are **gone** from Insights (they remain on Console `/`).
  7. Sanity-check: the 30-day active-vendor count roughly matches distinct users in `/admin/audit` over the same window.

---

## Notes for the implementer

- The `Insights` interface is frozen — if you find yourself changing a consumer (`KpiStrip`, `AttentionPanel`, `TopBars`, `Donut`), stop: the shape didn't change, only titles/among-bar stacking did.
- Every `$queryRaw` count is `BigInt` — the `.map(r => Number(r.n))` calls are load-bearing; a missing one yields `BigInt`-typed fields that break arithmetic/serialization.
- `"decision"::text` / `"accessMode"::text` casts the Postgres enums to text so the mapped rows are plain strings.
- Deploy: **v0.55.0, manager-only** — bump the manager image tag, `docker compose pull access-manager` + `up -d access-manager`, verify `/login` 200 (`-H "Host: manager.access.captivo.io"` on `127.0.0.1:3100`) + `docker exec cap-access-manager sh -c 'echo $APP_VERSION'`, then Gate A, then `gh release edit v0.55.0` with an English user-facing note.
```
