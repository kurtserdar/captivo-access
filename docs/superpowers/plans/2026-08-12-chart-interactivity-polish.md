# Chart Interactivity Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rich heatmap hover, drill-down from top-lists/trend into the pre-filtered audit log, interactive KPI sparklines, and load/hover animation to the dashboard charts.

**Architecture:** `getInsights()` gains `userId` and returns id-carrying `RefCount[]` top-lists (pure helper `topRef`, unit-tested). The audit table already reads filters from the URL, so drill-down is a client `router.push`. Recharts charts get click handlers + active-hover; the heatmap and KPI sparkline become small client components.

**Tech Stack:** Next.js 16 / React 19 (server + client components), Prisma 7, Recharts 3, vitest.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **Manager-only**, admin-only. **No schema change → no migrate.** No new dependency (Recharts present).
- Chart colours/tooltips use **CSS tokens** (`var(--ok)`, `var(--danger)`, `var(--accent)`, `var(--muted)`, `var(--surface)`, `var(--line)`, `var(--fg)`, `var(--surface-2)`) — light/dark both render.
- Drill-down ids are `encodeURIComponent`-wrapped; audit filter keys are `userId`, `siteId`, `from`, `to`.
- **No heatmap drill-down** (day-of-week × hour has no absolute date).
- **Verify:** `pnpm build`; `pnpm test`.

---

### Task 1: Aggregation — `userId` + `topRef`

**Files:**
- Modify: `src/lib/dashboard/insights.ts`
- Test: `src/lib/dashboard/insights.test.ts`

**Interfaces:**
- Produces: `interface RefCount { id: string; label: string; count: number }`, `topRef(rows, idField, nameField, limit, decision?)`, widened `AuditRow` (`userId`), and `Insights.topResources`/`topVendors` retyped to `RefCount[]`.

- [ ] **Step 1: Update the test `row()` helper + add the failing test**

In `src/lib/dashboard/insights.test.ts`, add `userId` to the `row()` default and import `topRef`:

```ts
import { buildTrend, buildHeatmap, topBy, denyReasons, ipFlags, activeVendors, typeMix, sessionStats, topRef, type AuditRow } from "./insights";

function row(p: Partial<AuditRow> & { timestamp: Date; decision: "ALLOW" | "DENY" }): AuditRow {
  return { siteName: null, siteId: null, userId: null, userEmail: null, clientIp: null, reason: null, ...p };
}
```

Append:

```ts
describe("topRef", () => {
  it("groups by id, labels by name, falls back to id, skips null id, sorts desc, honors decision", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s1", siteName: "Alpha" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s1", siteName: "Alpha" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s2", siteName: null }),   // name null → id fallback
      row({ timestamp: new Date(), decision: "DENY",  siteId: "s1", siteName: "Alpha" }), // deny ignored
      row({ timestamp: new Date(), decision: "ALLOW", siteId: null, siteName: "X" }),     // null id skipped
    ];
    expect(topRef(rows, "siteId", "siteName", 5)).toEqual([
      { id: "s1", label: "Alpha", count: 2 },
      { id: "s2", label: "s2", count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: FAIL — `topRef` not exported; `userId` not on `AuditRow`.

- [ ] **Step 3: Implement in `src/lib/dashboard/insights.ts`**

Add `userId` to `AuditRow` (after `siteId`):

```ts
  siteId: string | null;
  userId: string | null;
  userEmail: string | null;
```

Add the helper (after `topBy`):

```ts
export interface RefCount { id: string; label: string; count: number }

// Group by an id field, label by a name field (fallback to id), desc, top `limit`.
export function topRef(
  rows: AuditRow[],
  idField: "siteId" | "userId",
  nameField: "siteName" | "userEmail",
  limit: number,
  decision: "ALLOW" | "DENY" = "ALLOW",
): RefCount[] {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const r of rows) {
    if (r.decision !== decision) continue;
    const id = r[idField];
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const nm = r[nameField];
    if (nm && !names.has(id)) names.set(id, nm);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: names.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
```

Retype the two `Insights` fields:

```ts
  topResources: RefCount[];
  topVendors: RefCount[];
```

In `getInsights`, add `userId: true` to the audit `select`:

```ts
      select: { timestamp: true, decision: true, siteName: true, siteId: true, userId: true, userEmail: true, clientIp: true, reason: true },
```

and replace the two `topBy` calls for resources/vendors:

```ts
    topResources: topRef(auditRows, "siteId", "siteName", 5),
    topVendors: topRef(auditRows, "userId", "userEmail", 5),
```

(Leave `topDenied: topBy(auditRows, "userEmail", 3, "DENY")` unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: PASS (topRef + all pre-existing cases).

- [ ] **Step 5: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/insights.ts src/lib/dashboard/insights.test.ts
git commit -m "feat(dashboard): topRef aggregation with stable ids for drill-down"
```

---

### Task 2: Recharts drill-down + active-hover

**Files:**
- Modify: `src/app/(app)/_dashboard/charts/top-bars.tsx`
- Modify: `src/app/(app)/_dashboard/charts/access-trend.tsx`
- Modify: `src/app/(app)/_dashboard/charts/donut.tsx`
- Modify: `src/app/(app)/_dashboard/dashboard-insights.tsx`

**Interfaces:**
- Consumes: `RefCount`, `TrendDay` (Task 1 / existing).
- Produces: `TopBars({ items: RefCount[]; hrefFor: (item: RefCount) => string })`.

> No unit test (presentational/navigation). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Rewrite `charts/top-bars.tsx`**

```tsx
"use client";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { RefCount } from "@/lib/dashboard/insights";

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function TopBars({ items, hrefFor }: { items: RefCount[]; hrefFor: (item: RefCount) => string }) {
  const router = useRouter();
  if (items.length === 0) return <p className="cell-sub">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(96, items.length * 36)}>
      <BarChart data={items} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TT} cursor={{ fill: "var(--surface-2)" }} />
        <Bar
          dataKey="count"
          fill="var(--accent)"
          radius={[0, 3, 3, 0]}
          cursor="pointer"
          activeBar={{ fill: "var(--accent)", opacity: 0.85 }}
          onClick={(_, index) => { const it = items[index]; if (it) router.push(hrefFor(it)); }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Update `charts/access-trend.tsx` — day drill-down + active bar**

Add `useRouter` and keep the full date on each datum; replace the component body's chart:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { TrendDay } from "@/lib/dashboard/insights";

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function AccessTrend({ data }: { data: TrendDay[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const total = data.reduce((s, d) => s + d.allow + d.deny, 0);
  if (total === 0) return <p className="cell-sub">No access in the last 30 days.</p>;
  const chartData = data.map((d) => ({ date: d.date.slice(5), fullDate: d.date, allow: d.allow, deny: d.deny }));
  const toggle = (o: unknown) => {
    const k = (o as { dataKey?: string }).dataKey;
    if (k) setHidden((h) => ({ ...h, [k]: !h[k] }));
  };
  const drill = (s: { activeTooltipIndex?: number }) => {
    const i = s?.activeTooltipIndex;
    if (i == null || !chartData[i]) return;
    const day = chartData[i].fullDate;
    router.push(`/admin/audit?from=${day}T00:00:00.000Z&to=${day}T23:59:59.999Z`);
  };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} onClick={drill} style={{ cursor: "pointer" }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} interval={4} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TT} cursor={{ fill: "var(--surface-2)" }} />
        <Legend onClick={toggle} wrapperStyle={{ fontSize: "12px", cursor: "pointer" }} />
        <Bar dataKey="allow" name="Allowed" stackId="a" fill="var(--ok)" hide={hidden.allow} activeBar={{ opacity: 0.85 }} />
        <Bar dataKey="deny" name="Denied" stackId="a" fill="var(--danger)" hide={hidden.deny} activeBar={{ opacity: 0.85 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Update `charts/donut.tsx` — active slice**

```tsx
"use client";
import { useState } from "react";
import { PieChart, Pie, Cell, Sector, Tooltip, ResponsiveContainer } from "recharts";

export interface Slice { label: string; value: number; color: string }

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function Donut({ slices }: { slices: Slice[] }) {
  const [active, setActive] = useState<number | undefined>(undefined);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p className="cell-sub">No data yet.</p>;
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="45%" height={130}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius={34}
            outerRadius={56}
            paddingAngle={2}
            stroke="none"
            activeIndex={active}
            activeShape={(props: React.ComponentProps<typeof Sector>) => <Sector {...props} outerRadius={(props.outerRadius ?? 56) + 4} />}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(undefined)}
          >
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

- [ ] **Step 4: Wire `hrefFor` in `dashboard-insights.tsx`**

Replace the two `<TopBars … />` usages:

```tsx
        <div className="card c-topr"><div className="card-head"><div className="ch-title"><h2>Top resources</h2></div></div><TopBars items={insights.topResources} hrefFor={(i) => `/admin/audit?siteId=${encodeURIComponent(i.id)}`} /></div>
        <div className="card c-topv"><div className="card-head"><div className="ch-title"><h2>Top vendors</h2></div></div><TopBars items={insights.topVendors} hrefFor={(i) => `/admin/audit?userId=${encodeURIComponent(i.id)}`} /></div>
```

- [ ] **Step 5: Verify build**

Run: `pnpm build`
Expected: PASS. (If Recharts' `activeShape` prop type rejects the inline function signature, type the parameter as `any` — `activeShape={(props: any) => <Sector {...props} outerRadius={props.outerRadius + 4} />}`.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/_dashboard/charts/top-bars.tsx" "src/app/(app)/_dashboard/charts/access-trend.tsx" "src/app/(app)/_dashboard/charts/donut.tsx" "src/app/(app)/_dashboard/dashboard-insights.tsx"
git commit -m "feat(dashboard): drill-down from top-lists/trend + active-hover on charts"
```

---

### Task 3: Interactive KPI sparkline

**Files:**
- Create: `src/app/(app)/_dashboard/charts/sparkline.tsx`
- Modify: `src/app/(app)/_dashboard/kpi-strip.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `Sparkline({ points: number[]; color: string })` (client).

> No unit test (presentational). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Create `src/app/(app)/_dashboard/charts/sparkline.tsx`**

```tsx
"use client";
import { useState } from "react";

export function Sparkline({ points, color }: { points: number[]; color: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(1, ...points);
  const w = 60, h = 18;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const xy = points.map((p, i) => ({ x: i * step, y: h - (p / max) * h, v: p }));
  const line = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <span className="spark-wrap">
      <svg
        className="kpi-spark"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - r.left) / r.width) * w;
          const idx = Math.round(rel / step);
          setHi(Math.max(0, Math.min(points.length - 1, idx)));
        }}
        onMouseLeave={() => setHi(null)}
      >
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
        {hi != null && <circle cx={xy[hi].x} cy={xy[hi].y} r={2} fill={color} />}
      </svg>
      {hi != null && <span className="spark-tip">{xy[hi].v}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Use it in `kpi-strip.tsx`**

Remove the local `Sparkline` function and add the import:

```tsx
import { Sparkline } from "./charts/sparkline";
```

(The two `<Sparkline points={…} color={…} />` call sites stay identical; `sinceLabel` stays.)

- [ ] **Step 3: Add styles to `src/app/globals.css`**

Append:

```css
.spark-wrap { position: absolute; right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 4px; }
.spark-wrap .kpi-spark { position: static; }
.spark-tip { font-size: .62rem; font-variant-numeric: tabular-nums; color: var(--fg); background: var(--surface-2); border: 1px solid var(--line); border-radius: 5px; padding: 0 4px; line-height: 1.3; }
```

> The existing `.kpi-spark { position: absolute; right: 8px; bottom: 8px; … }` rule stays; `.spark-wrap .kpi-spark { position: static }` overrides it inside the wrapper so the polyline sits normally and the wrapper handles placement.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/_dashboard/charts/sparkline.tsx" "src/app/(app)/_dashboard/kpi-strip.tsx" src/app/globals.css
git commit -m "feat(dashboard): interactive KPI sparklines (hover value)"
```

---

### Task 4: Rich heatmap hover

**Files:**
- Modify: `src/app/(app)/_dashboard/heatmap.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `Insights["heatmap"]` (unchanged prop).

> No unit test (presentational). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Rewrite `heatmap.tsx` as a client component with a rich tooltip**

```tsx
"use client";
import { useState } from "react";
import type { Insights } from "@/lib/dashboard/insights";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Hover = { dow: number; hour: number; v: number; x: number; y: number };

export function Heatmap({ heatmap }: { heatmap: Insights["heatmap"] }) {
  const [hov, setHov] = useState<Hover | null>(null);
  const max = Math.max(1, heatmap.max);
  return (
    <>
      <div className="card-head"><div className="ch-title"><h2>When vendors connect</h2><span className="sub">day × hour (UTC), last 30 days</span></div></div>
      <div className="heatmap-wrap" onMouseLeave={() => setHov(null)}>
        <div className="heatmap">
          {heatmap.grid.map((rowVals, dow) => (
            <div key={dow} className="heatmap-row">
              <span className="heatmap-day">{DAYS[dow]}</span>
              {rowVals.map((v, h) => (
                <span
                  key={h}
                  className={`heatmap-cell${hov && hov.dow === dow && hov.hour === h ? " hot" : ""}`}
                  style={{ opacity: v === 0 ? 0.06 : 0.18 + 0.82 * (v / max) }}
                  onMouseEnter={(e) => {
                    const wrap = e.currentTarget.closest(".heatmap-wrap") as HTMLElement;
                    const r = wrap.getBoundingClientRect();
                    const c = e.currentTarget.getBoundingClientRect();
                    setHov({ dow, hour: h, v, x: c.left - r.left + c.width / 2, y: c.top - r.top });
                  }}
                />
              ))}
            </div>
          ))}
          <div className="heatmap-axis"><span className="heatmap-day" />{[0, 6, 12, 18].map((h) => <span key={h}>{h}:00</span>)}</div>
        </div>
        {hov && (
          <div className="heat-tip" style={{ left: hov.x, top: hov.y }}>
            {DAYS[hov.dow]} {String(hov.hour).padStart(2, "0")}:00 UTC — {hov.v} access{hov.v === 1 ? "" : "es"}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add styles to `src/app/globals.css`**

Append:

```css
.heatmap-wrap { position: relative; }
.heatmap-cell.hot { outline: 1.5px solid var(--fg); outline-offset: -1px; }
.heat-tip { position: absolute; transform: translate(-50%, -130%); pointer-events: none; white-space: nowrap; background: var(--surface); border: 1px solid var(--line); color: var(--fg); font-size: .72rem; padding: 3px 7px; border-radius: 6px; box-shadow: var(--shadow); z-index: 5; }
```

- [ ] **Step 3: Verify build + full test**

Run: `pnpm build` — Expected: PASS.
Run: `pnpm test` — Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/_dashboard/heatmap.tsx" src/app/globals.css
git commit -m "feat(dashboard): rich heatmap hover tooltip + cell highlight"
```

- [ ] **Step 5: Gate A — live validation (operator, after deploy)**

After deploy (manager-only bump; no migrate), on the admin home (`/`):
1. **Heatmap:** hovering a cell shows a styled tooltip (`<Day> HH:00 UTC — N accesses`) and highlights the cell; no native browser tooltip.
2. **Top vendors:** clicking a bar opens `/admin/audit` filtered to that vendor; **Top resources:** clicking a bar filters to that resource; **Access trend:** clicking a day opens the audit filtered to that day's window.
3. **KPI sparklines** (Denials, Active vendors): hovering shows a dot on the line + the value.
4. Charts animate in; the hovered bar/slice highlights; light and dark both render.

---

## Self-Review

**1. Spec coverage:**
- `AuditRow.userId` + `topRef` + `getInsights` retype → Task 1. ✓
- TopBars drill-down (`hrefFor`, `router.push`, `activeBar`) + composer wiring → Task 2 (Steps 1, 4). ✓
- AccessTrend day-click drill + active bar → Task 2 (Step 2). ✓
- Donut active shape → Task 2 (Step 3). ✓
- Interactive `Sparkline` + kpi-strip wiring + CSS → Task 3. ✓
- Heatmap → client rich hover tooltip + highlight, native `title` removed, no drill-down → Task 4. ✓
- Theme tokens, encodeURIComponent, audit keys `userId`/`siteId`/`from`/`to`, manager-only/no-schema → Global Constraints + tasks. ✓
- Testing (`topRef` unit + Gate A) → Task 1 + Task 4 Step 5. ✓

**2. Placeholder scan:** No TBD/TODO. Every code step is concrete; the three presentational tasks state the no-unit-test justification and are build+Gate-A verified. A concrete fallback is given for the one Recharts typing risk (`activeShape` param → `any`).

**3. Type consistency:**
- `RefCount { id, label, count }` (Task 1) is the item type consumed by `TopBars` and the `hrefFor` builders (Task 2). ✓
- `Insights.topResources`/`topVendors` retyped to `RefCount[]` (Task 1) match `TopBars items` (Task 2). ✓
- `Sparkline({ points, color })` (Task 3) matches the existing kpi-strip call sites (`points={insights.trend.map(d=>d.deny)}`, `points={insights.activeVendors.series}`). ✓
- `Heatmap({ heatmap })` prop unchanged (Task 4) — composer passes `insights.heatmap` as before. ✓
- Audit drill targets use `userId`/`siteId`/`from`/`to`, the exact keys the audit table reads via `useSearchParams`. ✓
