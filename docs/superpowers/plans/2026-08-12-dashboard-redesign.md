# Dashboard Redesign (B-refined) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin dashboard's stat cards + hand-rolled SVG Insights with a "B-refined" bento — a KPI strip plus interactive Recharts charts — and add new metrics (active vendors, access-type mix, session activity, top-denied), all from existing tables.

**Architecture:** One server fetch (`getInsights()`, extended) feeds pure unit-tested helpers; the KPI strip also reuses `getDashboardStats()`. Charts are `"use client"` Recharts components fed plain-serializable props; heatmap, KPI sparklines, and text panels stay server-rendered. Colours are CSS-token strings so light/dark both work.

**Tech Stack:** Next.js 16 (server + client components), React 19, Prisma 7, Recharts 3, vitest.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **Manager-only**, admin-only. **No schema change → no `access-migrate`.** No data-plane/connector change.
- Adds **`recharts@^3`** (bundled dependency). No global CSP in captivo-access → client charts fine.
- Charts take colours as **CSS-token strings** (`var(--ok)`, `var(--danger)`, `var(--accent)`, `var(--warn)`, `var(--muted)`, `var(--surface)`, `var(--surface-2)`, `var(--line)`, `var(--fg)`) — never hardcoded hex — so both themes render.
- **Fixed 30-day window**; **UTC** bucketing.
- CSS lives in `src/app/globals.css` (NOT `(app)/globals.css`).
- **Verify:** `pnpm build`; `pnpm test`.

---

### Task 1: Extend aggregation helpers

**Files:**
- Modify: `src/lib/dashboard/insights.ts`
- Test: `src/lib/dashboard/insights.test.ts`

**Interfaces:**
- Consumes: existing `AuditRow`, `Labeled`, `topBy` (from the current file).
- Produces: `topBy(rows, field, limit, decision?)`, `activeVendors(rows, now, days?)`, `typeMix(rows, siteType)`, `sessionStats(recs)`, and a widened `AuditRow` with `siteId`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dashboard/insights.test.ts`:

```ts
import { activeVendors, typeMix, sessionStats } from "./insights";

describe("topBy with decision", () => {
  it("groups DENY by field when decision is DENY", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "DENY", userEmail: "u" }),
      row({ timestamp: new Date(), decision: "DENY", userEmail: "u" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u" }),
      row({ timestamp: new Date(), decision: "DENY", userEmail: "v" }),
    ];
    expect(topBy(rows, "userEmail", 5, "DENY")).toEqual([{ label: "u", count: 2 }, { label: "v", count: 1 }]);
  });
});

describe("activeVendors", () => {
  it("counts distinct ALLOW vendors and builds a 30-day daily-distinct series", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const rows = [
      row({ timestamp: new Date("2026-08-11T09:00:00Z"), decision: "ALLOW", userEmail: "a" }),
      row({ timestamp: new Date("2026-08-11T10:00:00Z"), decision: "ALLOW", userEmail: "b" }),
      row({ timestamp: new Date("2026-08-11T11:00:00Z"), decision: "ALLOW", userEmail: "a" }), // dup same day
      row({ timestamp: new Date("2026-08-10T10:00:00Z"), decision: "ALLOW", userEmail: "a" }),
      row({ timestamp: new Date("2026-08-11T10:00:00Z"), decision: "DENY", userEmail: "c" }),  // deny ignored
    ];
    const r = activeVendors(rows, now);
    expect(r.count).toBe(2);            // a, b
    expect(r.series.length).toBe(30);
    expect(r.series[29]).toBe(2);       // 08-11: a, b
    expect(r.series[28]).toBe(1);       // 08-10: a
  });
});

describe("typeMix", () => {
  it("buckets ALLOW events web/remote via the site-type map, skipping unmatched", () => {
    const map = new Map<string, "web" | "remote">([["s1", "web"], ["s2", "remote"]]);
    const rows = [
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s1" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s2" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s1" }),
      row({ timestamp: new Date(), decision: "DENY", siteId: "s1" }),  // deny ignored
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "x" }),  // unmatched
      row({ timestamp: new Date(), decision: "ALLOW", siteId: null }), // null
    ];
    expect(typeMix(rows, map)).toEqual({ web: 2, remote: 1 });
  });
});

describe("sessionStats", () => {
  it("computes recordings, total hours, avg minutes; empty → zeros", () => {
    const base = new Date("2026-08-11T10:00:00Z").getTime();
    const recs = [
      { startedAt: new Date(base), lastEventAt: new Date(base + 30 * 60000) },      // 30m
      { startedAt: new Date(base), lastEventAt: new Date(base + 90 * 60000) },      // 90m
    ];
    expect(sessionStats(recs)).toEqual({ recordings: 2, totalHours: 2, avgMinutes: 60 });
    expect(sessionStats([])).toEqual({ recordings: 0, totalHours: 0, avgMinutes: 0 });
  });
});
```

Also update the `row()` helper's type at the top of the file — add `siteId` to the default:

```ts
function row(p: Partial<AuditRow> & { timestamp: Date; decision: "ALLOW" | "DENY" }): AuditRow {
  return { siteName: null, siteId: null, userEmail: null, clientIp: null, reason: null, ...p };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: FAIL — `activeVendors`/`typeMix`/`sessionStats` are not exported; `siteId` not on `AuditRow`.

- [ ] **Step 3: Implement in `src/lib/dashboard/insights.ts`**

Add `siteId` to the `AuditRow` interface (after `siteName`):

```ts
  siteName: string | null;
  siteId: string | null;
```

Change `topBy` to take a `decision` param:

```ts
export function topBy(rows: AuditRow[], field: "siteName" | "userEmail", limit: number, decision: "ALLOW" | "DENY" = "ALLOW"): Labeled[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.decision !== decision) continue;
    const label = r[field];
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
```

Add the three new helpers (after `ipFlags`, before the `Insights` interface):

```ts
// Distinct ALLOW vendors over the window + a 30-day daily-distinct series (UTC, oldest→newest).
export function activeVendors(rows: AuditRow[], now: Date, days = 30): { count: number; series: number[] } {
  const keys: string[] = [];
  const perDay = new Map<string, Set<string>>();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    const k = dayKey(d);
    keys.push(k);
    perDay.set(k, new Set());
  }
  const all = new Set<string>();
  for (const r of rows) {
    if (r.decision !== "ALLOW" || !r.userEmail) continue;
    all.add(r.userEmail);
    const set = perDay.get(dayKey(r.timestamp));
    if (set) set.add(r.userEmail);
  }
  return { count: all.size, series: keys.map((k) => perDay.get(k)!.size) };
}

// ALLOW events bucketed web/remote via a siteId→type map; null/unmatched skipped.
export function typeMix(rows: AuditRow[], siteType: Map<string, "web" | "remote">): { web: number; remote: number } {
  let web = 0, remote = 0;
  for (const r of rows) {
    if (r.decision !== "ALLOW" || !r.siteId) continue;
    const t = siteType.get(r.siteId);
    if (t === "web") web++;
    else if (t === "remote") remote++;
  }
  return { web, remote };
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/insights.ts src/lib/dashboard/insights.test.ts
git commit -m "feat(dashboard): aggregation helpers for vendors, type mix, session stats, denied"
```

---

### Task 2: Extend `getInsights()`

**Files:**
- Modify: `src/lib/dashboard/insights.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `db`, `listActiveSessions` (already imported).
- Produces: widened `Insights` with `activeVendors`, `typeMix`, `sessionStats`, `topDenied`.

> No unit test (DB orchestration; shaping covered by Task 1). Verified by `pnpm build`.

- [ ] **Step 1: Widen the `Insights` interface**

Add these fields to `interface Insights` (after `activeSessions`):

```ts
  activeVendors: { count: number; series: number[] };
  typeMix: { web: number; remote: number };
  sessionStats: { recordings: number; totalHours: number; avgMinutes: number };
  topDenied: Labeled[];
```

- [ ] **Step 2: Extend `getInsights()`**

Add `siteId: true` to the audit `select`:

```ts
      select: { timestamp: true, decision: true, siteName: true, siteId: true, userEmail: true, clientIp: true, reason: true },
```

Add two fetches to the `Promise.all` (alongside the existing four) and capture them:

```ts
  const [rows, expiringRows, expiringCount, active, sites, recordings] = await Promise.all([
    db.auditEvent.findMany({
      where: { timestamp: { gte: since } },
      select: { timestamp: true, decision: true, siteName: true, siteId: true, userEmail: true, clientIp: true, reason: true },
    }),
    db.accessGrant.findMany({
      where: expiringWhere,
      select: { endsAt: true, user: { select: { email: true } }, site: { select: { name: true } } },
      orderBy: { endsAt: "asc" },
      take: 5,
    }),
    db.accessGrant.count({ where: expiringWhere }),
    listActiveSessions(),
    db.site.findMany({ select: { id: true, accessMode: true } }),
    db.sessionRecording.findMany({ where: { startedAt: { gte: since } }, select: { startedAt: true, lastEventAt: true } }),
  ]);

  const siteType = new Map<string, "web" | "remote">(
    sites.map((s) => [s.id, s.accessMode === "GATEWAY" ? "remote" : "web"] as const),
  );
```

Add the four new fields to the returned object (after `activeSessions`):

```ts
    activeVendors: activeVendors(auditRows, now),
    typeMix: typeMix(auditRows, siteType),
    sessionStats: sessionStats(recordings),
    topDenied: topBy(auditRows, "userEmail", 3, "DENY"),
```

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: PASS. (If Prisma's `accessMode` is a stricter enum literal, the `=== "GATEWAY"` comparison still narrows correctly.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboard/insights.ts
git commit -m "feat(dashboard): getInsights returns vendor/type-mix/session/denied metrics"
```

---

### Task 3: Recharts client charts

**Files:**
- Modify: `package.json` (add `recharts`)
- Create: `src/app/(app)/_dashboard/charts/access-trend.tsx`
- Create: `src/app/(app)/_dashboard/charts/donut.tsx`
- Create: `src/app/(app)/_dashboard/charts/top-bars.tsx`

**Interfaces:**
- Consumes: `TrendDay`, `Labeled` from `@/lib/dashboard/insights`.
- Produces: `AccessTrend({ data })`, `Donut({ slices })` with `interface Slice`, `TopBars({ items })`.

> No unit test (presentational Recharts). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add recharts@^3`
Expected: `package.json` gains `"recharts": "^3.x"`; lockfile updates.

- [ ] **Step 2: Create `src/app/(app)/_dashboard/charts/access-trend.tsx`**

```tsx
"use client";
import { useState } from "react";
import { BarChart, Bar, XAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { TrendDay } from "@/lib/dashboard/insights";

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function AccessTrend({ data }: { data: TrendDay[] }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const total = data.reduce((s, d) => s + d.allow + d.deny, 0);
  if (total === 0) return <p className="cell-sub">No access in the last 30 days.</p>;
  const chartData = data.map((d) => ({ date: d.date.slice(5), allow: d.allow, deny: d.deny }));
  const toggle = (o: unknown) => {
    const k = (o as { dataKey?: string }).dataKey;
    if (k) setHidden((h) => ({ ...h, [k]: !h[k] }));
  };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} interval={4} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TT} cursor={{ fill: "var(--surface-2)" }} />
        <Legend onClick={toggle} wrapperStyle={{ fontSize: "12px", cursor: "pointer" }} />
        <Bar dataKey="allow" name="Allowed" stackId="a" fill="var(--ok)" hide={hidden.allow} />
        <Bar dataKey="deny" name="Denied" stackId="a" fill="var(--danger)" hide={hidden.deny} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/_dashboard/charts/donut.tsx`**

```tsx
"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export interface Slice { label: string; value: number; color: string }

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function Donut({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p className="cell-sub">No data yet.</p>;
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="45%" height={130}>
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius={34} outerRadius={56} paddingAngle={2} stroke="none">
            {slices.map((s) => <Cell key={s.label} fill={s.color} />)}
          </Pie>
          <Tooltip contentStyle={TT} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.label}><span className="dot" style={{ background: s.color }} /> {s.label} · {s.value}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/_dashboard/charts/top-bars.tsx`**

```tsx
"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { Labeled } from "@/lib/dashboard/insights";

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function TopBars({ items }: { items: Labeled[] }) {
  if (items.length === 0) return <p className="cell-sub">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(96, items.length * 36)}>
      <BarChart data={items} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TT} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="count" fill="var(--accent)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: Verify the build**

Run: `pnpm build`
Expected: PASS (Recharts types resolve; the three client components compile). The old dashboard still renders — nothing wired yet.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml "src/app/(app)/_dashboard/charts"
git commit -m "feat(dashboard): Recharts client charts — access trend, donut, top bars"
```

---

### Task 4: KPI strip, server pieces, bento composer, wiring

**Files:**
- Create: `src/app/(app)/_dashboard/kpi-strip.tsx`
- Create: `src/app/(app)/_dashboard/heatmap.tsx`
- Create: `src/app/(app)/_dashboard/session-stats.tsx`
- Create: `src/app/(app)/_dashboard/attention-panel.tsx`
- Create: `src/app/(app)/_dashboard/dashboard-insights.tsx`
- Delete: `src/app/(app)/_dashboard/insights-panel.tsx`
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `DashboardStats` (`@/lib/dashboard/stats`), `Insights` (`@/lib/dashboard/insights`), Task 3 charts.
- Produces: `DashboardInsights({ stats, insights })`.

> No unit test (presentational). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Create `src/app/(app)/_dashboard/kpi-strip.tsx`**

```tsx
import type { DashboardStats } from "@/lib/dashboard/stats";
import type { Insights } from "@/lib/dashboard/insights";

function sinceLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const max = Math.max(1, ...points);
  const w = 60, h = 18;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const pts = points.map((p, i) => `${(i * step).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`).join(" ");
  return <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} /></svg>;
}

export function KpiStrip({ stats, insights }: { stats: DashboardStats; insights: Insights }) {
  const longest = insights.activeSessions.longestStartedAt ? sinceLabel(insights.activeSessions.longestStartedAt) : null;
  return (
    <div className="kpis">
      <div className="kpi"><div className="k">Connectors</div><div className="v">{stats.connectorsOnline}/{stats.connectors}</div><div className="s">{stats.connectorsOnline === stats.connectors ? "all online" : `${stats.connectors - stats.connectorsOnline} offline`}</div></div>
      <div className="kpi"><div className="k">Resources</div><div className="v">{stats.sitesReachable}/{stats.sites}</div><div className="s">{stats.sitesDown > 0 ? `${stats.sitesDown} down` : "reachable"}</div></div>
      <div className="kpi"><div className="k">Active grants</div><div className="v">{stats.activeGrants}</div><div className="s">{stats.pending > 0 ? `${stats.pending} pending approval` : "no pending"}</div></div>
      <div className="kpi"><div className="k">Sessions now</div><div className="v">{insights.activeSessions.count}</div><div className="s">{longest ? `longest ${longest}` : "none active"}</div></div>
      <div className="kpi"><div className="k">Denials 30d</div><div className="v" style={{ color: insights.deny.total > 0 ? "var(--danger)" : undefined }}>{insights.deny.total}</div><Sparkline points={insights.trend.map((d) => d.deny)} color="var(--danger)" /></div>
      <div className="kpi"><div className="k">Active vendors 30d</div><div className="v">{insights.activeVendors.count}</div><Sparkline points={insights.activeVendors.series} color="var(--accent)" /></div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(app)/_dashboard/heatmap.tsx`**

```tsx
import type { Insights } from "@/lib/dashboard/insights";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Heatmap({ heatmap }: { heatmap: Insights["heatmap"] }) {
  const max = Math.max(1, heatmap.max);
  return (
    <>
      <div className="card-head"><div className="ch-title"><h2>When vendors connect</h2><span className="sub">day × hour (UTC), last 30 days</span></div></div>
      <div className="heatmap">
        {heatmap.grid.map((rowVals, dow) => (
          <div key={dow} className="heatmap-row">
            <span className="heatmap-day">{DAYS[dow]}</span>
            {rowVals.map((v, h) => (
              <span key={h} className="heatmap-cell" style={{ opacity: v === 0 ? 0.06 : 0.18 + 0.82 * (v / max) }} title={`${DAYS[dow]} ${String(h).padStart(2, "0")}:00 UTC — ${v}`} />
            ))}
          </div>
        ))}
        <div className="heatmap-axis"><span className="heatmap-day" />{[0, 6, 12, 18].map((h) => <span key={h}>{h}:00</span>)}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/_dashboard/session-stats.tsx`**

```tsx
import type { Insights } from "@/lib/dashboard/insights";

export function SessionStats({ stats }: { stats: Insights["sessionStats"] }) {
  return (
    <>
      <div className="card-head"><div className="ch-title"><h2>Session activity</h2><span className="sub">last 30 days</span></div></div>
      <div className="sess3">
        <div><div className="v">{stats.recordings}</div><div className="k">recordings</div></div>
        <div><div className="v">{stats.totalHours}h</div><div className="k">captured</div></div>
        <div><div className="v">{stats.avgMinutes}m</div><div className="k">avg length</div></div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/_dashboard/attention-panel.tsx`**

```tsx
import type { Insights } from "@/lib/dashboard/insights";

export function AttentionPanel({ insights }: { insights: Insights }) {
  const { ipFlags, expiring, topDenied } = insights;
  return (
    <>
      <div className="card-head"><div className="ch-title"><h2>Attention</h2><span className="sub">security &amp; ops</span></div></div>
      <div className="att">
        <div>
          <div className="ak">IP-diversity flags</div>
          {ipFlags.length === 0 ? <div className="cell-sub">None</div> : ipFlags.map((f) => (
            <div key={f.userEmail} className="att-row"><span className="pill warn">{f.ipCount} IPs</span> {f.userEmail}</div>
          ))}
        </div>
        <div>
          <div className="ak">Grants expiring (7d)</div>
          {expiring.count === 0 ? <div className="cell-sub">None</div> : expiring.soonest.map((g, i) => (
            <div key={i} className="att-row">{g.userEmail} → {g.siteName}</div>
          ))}
        </div>
        <div>
          <div className="ak">Top denied</div>
          {topDenied.length === 0 ? <div className="cell-sub">None</div> : topDenied.map((d) => (
            <div key={d.label} className="att-row"><span className="pill danger">{d.count}</span> {d.label}</div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Create `src/app/(app)/_dashboard/dashboard-insights.tsx`**

```tsx
import type { DashboardStats } from "@/lib/dashboard/stats";
import type { Insights } from "@/lib/dashboard/insights";
import { KpiStrip } from "./kpi-strip";
import { Heatmap } from "./heatmap";
import { SessionStats } from "./session-stats";
import { AttentionPanel } from "./attention-panel";
import { AccessTrend } from "./charts/access-trend";
import { Donut } from "./charts/donut";
import { TopBars } from "./charts/top-bars";

const DENY_COLORS = ["var(--danger)", "var(--warn)", "var(--accent)", "#6f8bd6", "#a78bfa"];

export function DashboardInsights({ stats, insights }: { stats: DashboardStats; insights: Insights }) {
  const denySlices = insights.deny.reasons.map((r, i) => ({ label: r.label, value: r.count, color: DENY_COLORS[i % DENY_COLORS.length] }));
  const typeSlices = [
    { label: "Web", value: insights.typeMix.web, color: "var(--ok)" },
    { label: "Remote", value: insights.typeMix.remote, color: "var(--accent)" },
  ];
  return (
    <div className="dash-b">
      <KpiStrip stats={stats} insights={insights} />
      <div className="bento">
        <div className="card c-access"><div className="card-head"><div className="ch-title"><h2>Access — 30 days</h2><span className="sub">allowed vs denied</span></div></div><AccessTrend data={insights.trend} /></div>
        <div className="card c-heat"><Heatmap heatmap={insights.heatmap} /></div>
        <div className="card c-deny"><div className="card-head"><div className="ch-title"><h2>Deny reasons</h2><span className="sub">{insights.deny.total} total</span></div></div><Donut slices={denySlices} /></div>
        <div className="card c-type"><div className="card-head"><div className="ch-title"><h2>Access type mix</h2></div></div><Donut slices={typeSlices} /></div>
        <div className="card c-topr"><div className="card-head"><div className="ch-title"><h2>Top resources</h2></div></div><TopBars items={insights.topResources} /></div>
        <div className="card c-topv"><div className="card-head"><div className="ch-title"><h2>Top vendors</h2></div></div><TopBars items={insights.topVendors} /></div>
        <div className="card c-sess"><SessionStats stats={insights.sessionStats} /></div>
        <div className="card c-att"><AttentionPanel insights={insights} /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire into `src/app/(app)/page.tsx` and delete the old panel**

Replace the old imports:

```tsx
import { getInsights } from "@/lib/dashboard/insights";
import { StatCards } from "./_dashboard/stat-cards";
import { InsightsPanel } from "./_dashboard/insights-panel";
```

with:

```tsx
import { getInsights } from "@/lib/dashboard/insights";
import { DashboardInsights } from "./_dashboard/dashboard-insights";
```

(Keep the `SiteHealthPanel` / `RecentActivityPanel` imports.) The `Promise.all` line that already includes `getInsights()` stays. Replace the render block:

```tsx
      <StatCards s={stats} />
      <InsightsPanel data={insights} />
      <div className="dash-cols">
```

with:

```tsx
      <DashboardInsights stats={stats} insights={insights} />
      <div className="dash-cols">
```

Then delete the old file:

```bash
git rm "src/app/(app)/_dashboard/insights-panel.tsx"
```

> `stat-cards.tsx` stays on disk (no longer imported by the dashboard) — leave it; removing it is out of scope.

- [ ] **Step 7: Replace the CSS block in `src/app/globals.css`**

Delete the existing `/* Dashboard insights */` block (from that comment through the `.attention-v` rule) and append this in its place:

```css
/* Dashboard (B-refined) */
.dash-b { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; }

.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
@media (max-width: 1000px) { .kpis { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 560px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
.kpi { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px; }
.kpi .k { font-size: .6rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.kpi .v { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
.kpi .s { font-size: .64rem; color: var(--muted); margin-top: 1px; }
.kpi-spark { position: absolute; right: 8px; bottom: 8px; width: 60px; height: 18px; opacity: .9; }

.bento { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; }
.bento .card { margin: 0; }
.c-access { grid-column: span 7; grid-row: span 2; }
.c-heat { grid-column: span 5; }
.c-deny { grid-column: span 5; }
.c-type { grid-column: span 4; }
.c-topr { grid-column: span 4; }
.c-topv { grid-column: span 4; }
.c-sess { grid-column: span 4; }
.c-att { grid-column: span 12; }
@media (max-width: 820px) { .bento { grid-template-columns: 1fr; } .bento > * { grid-column: auto !important; grid-row: auto !important; } }

.donut-wrap { display: flex; align-items: center; gap: 12px; }
.donut-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: .78rem; }
.donut-legend .dot, .kpi .dot { width: .6rem; height: .6rem; border-radius: 50%; display: inline-block; margin-right: 5px; }

.heatmap { display: flex; flex-direction: column; gap: 2px; }
.heatmap-row { display: grid; grid-template-columns: 2.5rem repeat(24, 1fr); gap: 2px; align-items: center; }
.heatmap-day { font-size: .72rem; color: var(--muted); }
.heatmap-cell { height: 12px; border-radius: 2px; background: var(--ok); }
.heatmap-axis { display: grid; grid-template-columns: 2.5rem repeat(4, 1fr); font-size: .68rem; color: var(--muted); margin-top: 2px; }

.sess3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center; padding: 6px 0; }
.sess3 .v { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.sess3 .k { font-size: .58rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }

.att { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 700px) { .att { grid-template-columns: 1fr; } }
.att .ak { font-size: .62rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.att-row { font-size: .78rem; margin: 4px 0; display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 8: Verify the build**

Run: `pnpm build`
Expected: PASS. Then `pnpm test` — Expected: all suites PASS.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/_dashboard/kpi-strip.tsx" "src/app/(app)/_dashboard/heatmap.tsx" "src/app/(app)/_dashboard/session-stats.tsx" "src/app/(app)/_dashboard/attention-panel.tsx" "src/app/(app)/_dashboard/dashboard-insights.tsx" "src/app/(app)/page.tsx" src/app/globals.css
git rm "src/app/(app)/_dashboard/insights-panel.tsx"
git commit -m "feat(dashboard): B-refined bento — KPI strip, interactive charts, attention"
```

- [ ] **Step 10: Gate A — live validation (operator, after deploy)**

After deploy (add recharts, bump `access-manager`; no migrate), on the admin home (`/`):
1. **KPI strip** — 6 tiles; denials + active-vendors show sparklines; sessions shows count + longest.
2. **Access — 30 days** — stacked allow/deny bars; hovering a day shows a tooltip; clicking **Denied** in the legend hides the denied series (and restores it).
3. **Heatmap** lights up on active hours; hovering a cell shows the day/hour/count.
4. **Deny reasons** + **Access type mix** donuts render with legends.
5. **Top resources** / **Top vendors** horizontal bars with tooltips.
6. **Session activity** three numbers; **Attention** shows IP flags / expiring / top-denied.
7. A fresh install shows tasteful empty states; **light and dark** both render correctly.

---

## Self-Review

**1. Spec coverage:**
- `topBy`+decision, `activeVendors`, `typeMix`, `sessionStats`, `AuditRow.siteId` → Task 1. ✓
- `getInsights` extension (siteId select, sites map, recordings fetch, 4 new fields, `topDenied`) → Task 2. ✓
- Recharts dep + `AccessTrend` (stacked bar, tooltip, legend-toggle) + `Donut` + `TopBars` → Task 3. ✓
- KPI strip (6 tiles, sparklines on denials+vendors), heatmap extract, session-stats, attention (IP flags/expiring/top-denied), bento composer, page wiring, CSS bento, delete old panel → Task 4. ✓
- Theme-token colours, fixed 30d/UTC, manager-only/no-schema, English/no-signature → Global Constraints + tasks. ✓
- Empty states, data-plane fail-soft, null handling → helpers (Task 1/2) + chart empty states (Task 3) + panel empties (Task 4). ✓
- Testing (extended unit cases; Gate A) → Task 1 + Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is concrete. The three build-verified-only tasks (getInsights orchestration, Recharts components, presentational pieces) state the justification, matching the repo's untested-route/component pattern.

**3. Type consistency:**
- `AuditRow` gains `siteId` in Task 1; used by `typeMix` (Task 1) and the `getInsights` select (Task 2). ✓
- `topBy(rows, field, limit, decision?)` — new 4th param (Task 1); called with `"DENY"` for `topDenied` (Task 2) and defaulted elsewhere. ✓
- `Insights` fields added in Task 2 (`activeVendors`, `typeMix`, `sessionStats`, `topDenied`) are consumed field-for-field by `KpiStrip`, `SessionStats`, `AttentionPanel`, and `DashboardInsights` (Task 4). ✓
- `Slice` (Task 3 `donut.tsx`) matches the `{label,value,color}` objects built in `DashboardInsights` (Task 4). ✓
- `AccessTrend({ data })`, `Donut({ slices })`, `TopBars({ items })` (Task 3) match their call sites in `DashboardInsights` (Task 4). ✓
- `DashboardStats` fields used (`connectors`, `connectorsOnline`, `sites`, `sitesReachable`, `sitesDown`, `activeGrants`, `pending`) match the existing type consumed by the old `StatCards`. ✓
