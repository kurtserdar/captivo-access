# Dashboard Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visual Insights section below the stat cards on the admin home — 30-day access trend, day×hour heatmap, top resources/vendors, and an attention panel — from the audit trail, using pure aggregation + inline SVG.

**Architecture:** One 30-day `AuditEvent` fetch (six columns) feeds pure, unit-tested JS helpers that shape every metric; `getInsights()` also pulls expiring grants and active sessions. `InsightsPanel` renders it as server-side inline SVG (no chart lib, CSP-safe), matching the existing `stat-cards.tsx` style.

**Tech Stack:** Next.js 16 (server components), Prisma 7, vitest. No new dependency.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **Manager-only**, admin-only. **No schema change → no `access-migrate`.** No data-plane/connector change.
- **No new dependency**; **no raw SQL** — aggregate in pure JS helpers.
- **Inline SVG only** (strict CSP forbids external chart scripts); server-rendered, no client JS.
- **Fixed 30-day window**; **UTC** day/hour bucketing (noted in the UI).
- `IP_FLAG_THRESHOLD = 3` distinct IPs.
- Colours reuse existing tokens (`--ok`, `--danger`, `--warn`).
- **Verify:** `pnpm build`; `pnpm test`.

---

### Task 1: Pure aggregation helpers

**Files:**
- Create: `src/lib/dashboard/insights.ts`
- Test: `src/lib/dashboard/insights.test.ts`

**Interfaces:**
- Produces: the types below + `buildTrend`, `buildHeatmap`, `topBy`, `denyReasons`, `ipFlags`, and `IP_FLAG_THRESHOLD`. (`getInsights` is added in Task 2.)

- [ ] **Step 1: Write the failing test**

Create `src/lib/dashboard/insights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTrend, buildHeatmap, topBy, denyReasons, ipFlags, type AuditRow } from "./insights";

function row(p: Partial<AuditRow> & { timestamp: Date; decision: "ALLOW" | "DENY" }): AuditRow {
  return { siteName: null, userEmail: null, clientIp: null, reason: null, ...p };
}

describe("buildTrend", () => {
  it("zero-fills 30 UTC days oldest→newest and buckets allow/deny", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const rows = [
      row({ timestamp: new Date("2026-08-11T09:00:00Z"), decision: "ALLOW" }),
      row({ timestamp: new Date("2026-08-11T10:00:00Z"), decision: "DENY" }),
      row({ timestamp: new Date("2026-08-10T10:00:00Z"), decision: "ALLOW" }),
      row({ timestamp: new Date("2026-07-01T10:00:00Z"), decision: "ALLOW" }), // outside 30d
    ];
    const t = buildTrend(rows, now);
    expect(t.length).toBe(30);
    expect(t[29]).toEqual({ date: "2026-08-11", allow: 1, deny: 1 });
    expect(t[28]).toEqual({ date: "2026-08-10", allow: 1, deny: 0 });
    expect(t.reduce((s, d) => s + d.allow, 0)).toBe(2); // the 07-01 row is out of window
  });
});

describe("buildHeatmap", () => {
  it("increments the correct UTC day×hour cell and reports max", () => {
    const ts = new Date("2026-08-11T09:00:00Z");
    const { grid, max } = buildHeatmap([row({ timestamp: ts, decision: "ALLOW" }), row({ timestamp: ts, decision: "DENY" })]);
    expect(grid[ts.getUTCDay()][9]).toBe(2);
    expect(max).toBe(2);
  });
});

describe("topBy", () => {
  it("counts ALLOW by field, skips nulls, sorts desc, limits", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "ALLOW", siteName: "A" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteName: "A" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteName: "B" }),
      row({ timestamp: new Date(), decision: "DENY", siteName: "A" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteName: null }),
    ];
    expect(topBy(rows, "siteName", 5)).toEqual([{ label: "A", count: 2 }, { label: "B", count: 1 }]);
  });
});

describe("denyReasons", () => {
  it("groups DENY reasons, maps null→unspecified, totals + top N", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "DENY", reason: "no grant" }),
      row({ timestamp: new Date(), decision: "DENY", reason: "no grant" }),
      row({ timestamp: new Date(), decision: "DENY", reason: null }),
      row({ timestamp: new Date(), decision: "ALLOW", reason: "x" }),
    ];
    const d = denyReasons(rows, 5);
    expect(d.total).toBe(3);
    expect(d.reasons).toEqual([{ label: "no grant", count: 2 }, { label: "unspecified", count: 1 }]);
  });
});

describe("ipFlags", () => {
  it("flags vendors with >= threshold distinct IPs", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u", clientIp: "1.1.1.1" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u", clientIp: "2.2.2.2" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u", clientIp: "3.3.3.3" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "v", clientIp: "1.1.1.1" }),
    ];
    expect(ipFlags(rows, 3)).toEqual([{ userEmail: "u", ipCount: 3 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: FAIL — module `./insights` not found.

- [ ] **Step 3: Implement `src/lib/dashboard/insights.ts`**

```ts
export interface TrendDay { date: string; allow: number; deny: number }
export interface Labeled { label: string; count: number }
export interface IpFlag { userEmail: string; ipCount: number }

export interface AuditRow {
  timestamp: Date;
  decision: "ALLOW" | "DENY";
  siteName: string | null;
  userEmail: string | null;
  clientIp: string | null;
  reason: string | null;
}

export const IP_FLAG_THRESHOLD = 3;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// 30 zero-filled UTC days, oldest→newest, allow/deny counted per day.
export function buildTrend(rows: AuditRow[], now: Date, days = 30): TrendDay[] {
  const keys: string[] = [];
  const counts = new Map<string, { allow: number; deny: number }>();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    const k = dayKey(d);
    keys.push(k);
    counts.set(k, { allow: 0, deny: 0 });
  }
  for (const r of rows) {
    const c = counts.get(dayKey(r.timestamp));
    if (!c) continue;
    if (r.decision === "ALLOW") c.allow++;
    else c.deny++;
  }
  return keys.map((k) => ({ date: k, allow: counts.get(k)!.allow, deny: counts.get(k)!.deny }));
}

// 7×24 counts by UTC weekday (0=Sun) × hour, plus the busiest cell.
export function buildHeatmap(rows: AuditRow[]): { grid: number[][]; max: number } {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const r of rows) {
    const v = ++grid[r.timestamp.getUTCDay()][r.timestamp.getUTCHours()];
    if (v > max) max = v;
  }
  return { grid, max };
}

// ALLOW-only counts by a label field, nulls skipped, desc, top `limit`.
export function topBy(rows: AuditRow[], field: "siteName" | "userEmail", limit: number): Labeled[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.decision !== "ALLOW") continue;
    const label = r[field];
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// DENY-only reason breakdown (null → "unspecified"), total + top `limit`.
export function denyReasons(rows: AuditRow[], limit: number): { total: number; reasons: Labeled[] } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.decision !== "DENY") continue;
    total++;
    const reason = r.reason ?? "unspecified";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const reasons = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { total, reasons };
}

// Vendors seen from >= `threshold` distinct client IPs, desc by IP count.
export function ipFlags(rows: AuditRow[], threshold: number): IpFlag[] {
  const byUser = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.userEmail || !r.clientIp) continue;
    let set = byUser.get(r.userEmail);
    if (!set) {
      set = new Set();
      byUser.set(r.userEmail, set);
    }
    set.add(r.clientIp);
  }
  return [...byUser.entries()]
    .map(([userEmail, ips]) => ({ userEmail, ipCount: ips.size }))
    .filter((f) => f.ipCount >= threshold)
    .sort((a, b) => b.ipCount - a.ipCount);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/dashboard/insights.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/insights.ts src/lib/dashboard/insights.test.ts
git commit -m "feat(dashboard): pure audit-aggregation helpers for insights"
```

---

### Task 2: `getInsights()` orchestration

**Files:**
- Modify: `src/lib/dashboard/insights.ts`

**Interfaces:**
- Consumes: the Task 1 helpers; `db` (`@/lib/db`); `listActiveSessions` (`@/lib/dataplane/client`).
- Produces: `interface Insights` and `getInsights(now?: Date): Promise<Insights>`.

> No unit test (DB + network orchestration; the shaping logic is covered by Task 1). Verified by `pnpm build`.

- [ ] **Step 1: Add the `Insights` type + `getInsights` to `src/lib/dashboard/insights.ts`**

At the top, add the imports:

```ts
import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/dataplane/client";
```

At the end of the file, add:

```ts
export interface Insights {
  trend: TrendDay[];
  heatmap: { grid: number[][]; max: number };
  topResources: Labeled[];
  topVendors: Labeled[];
  deny: { total: number; reasons: Labeled[] };
  ipFlags: IpFlag[];
  expiring: { count: number; soonest: { userEmail: string; siteName: string; endsAt: string }[] };
  activeSessions: { count: number; longestStartedAt: string | null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getInsights(now = new Date()): Promise<Insights> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const in7d = new Date(now.getTime() + 7 * DAY_MS);
  const expiringWhere = { status: "ACTIVE" as const, endsAt: { gte: now, lte: in7d } };

  const [rows, expiringRows, expiringCount, active] = await Promise.all([
    db.auditEvent.findMany({
      where: { timestamp: { gte: since } },
      select: { timestamp: true, decision: true, siteName: true, userEmail: true, clientIp: true, reason: true },
    }),
    db.accessGrant.findMany({
      where: expiringWhere,
      select: { endsAt: true, user: { select: { email: true } }, site: { select: { name: true } } },
      orderBy: { endsAt: "asc" },
      take: 5,
    }),
    db.accessGrant.count({ where: expiringWhere }),
    listActiveSessions(),
  ]);

  // `rows` already matches AuditRow (decision is the AuditDecision "ALLOW"|"DENY").
  const auditRows: AuditRow[] = rows;
  const longestStartedAt = active.length ? [...active].map((a) => a.startedAt).sort()[0] : null;

  return {
    trend: buildTrend(auditRows, now),
    heatmap: buildHeatmap(auditRows),
    topResources: topBy(auditRows, "siteName", 5),
    topVendors: topBy(auditRows, "userEmail", 5),
    deny: denyReasons(auditRows, 5),
    ipFlags: ipFlags(auditRows, IP_FLAG_THRESHOLD),
    expiring: {
      count: expiringCount,
      soonest: expiringRows.map((g) => ({
        userEmail: g.user.email ?? "—",
        siteName: g.site.name,
        endsAt: (g.endsAt as Date).toISOString(),
      })),
    },
    activeSessions: { count: active.length, longestStartedAt },
  };
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: PASS. (If the `auditRows: AuditRow[] = rows` assignment errors on the enum, change it to `const auditRows = rows as AuditRow[];`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard/insights.ts
git commit -m "feat(dashboard): getInsights — 30d audit fetch + expiring grants + active sessions"
```

---

### Task 3: InsightsPanel (inline SVG) + styles + home wiring

**Files:**
- Create: `src/app/(app)/_dashboard/insights-panel.tsx`
- Modify: `src/app/(app)/globals.css`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `Insights`, `getInsights` (Task 2); `TrendDay`, `Labeled` types (Task 1).
- Produces: `InsightsPanel({ data }: { data: Insights })`.

> No unit test (presentational server component). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Implement `src/app/(app)/_dashboard/insights-panel.tsx`**

```tsx
import type { Insights, TrendDay, Labeled } from "@/lib/dashboard/insights";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TrendChart({ trend }: { trend: TrendDay[] }) {
  const max = Math.max(1, ...trend.map((d) => d.allow + d.deny));
  const allow = trend.reduce((s, d) => s + d.allow, 0);
  const deny = trend.reduce((s, d) => s + d.deny, 0);
  const W = 100, H = 40, colW = W / trend.length, bw = colW * 0.72;
  return (
    <div className="card">
      <div className="card-head"><div className="ch-title"><h2>Access (30 days)</h2><span className="sub">{allow} allowed · {deny} denied</span></div></div>
      {allow + deny === 0 ? (
        <p className="cell-sub">No access in the last 30 days.</p>
      ) : (
        <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Daily allowed vs denied access, last 30 days">
          {trend.map((d, i) => {
            const total = d.allow + d.deny;
            if (total === 0) return null;
            const h = (total / max) * H;
            const allowH = (d.allow / total) * h;
            const x = i * colW + (colW - bw) / 2;
            return (
              <g key={d.date}>
                {d.deny > 0 && <rect x={x} y={H - h} width={bw} height={h - allowH} className="trend-deny" />}
                {d.allow > 0 && <rect x={x} y={H - allowH} width={bw} height={allowH} className="trend-allow" />}
              </g>
            );
          })}
        </svg>
      )}
      <div className="chart-legend"><span className="dot ok" /> Allowed <span className="dot danger" /> Denied</div>
    </div>
  );
}

function Heatmap({ heatmap }: { heatmap: Insights["heatmap"] }) {
  const max = Math.max(1, heatmap.max);
  return (
    <div className="card">
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
    </div>
  );
}

function TopList({ title, items, empty }: { title: string; items: Labeled[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="card">
      <div className="card-head"><div className="ch-title"><h2>{title}</h2></div></div>
      {items.length === 0 ? (
        <p className="cell-sub">{empty}</p>
      ) : (
        <ul className="toplist">
          {items.map((it) => (
            <li key={it.label}>
              <span className="toplist-label cell-truncate" title={it.label}>{it.label}</span>
              <span className="toplist-bar"><span style={{ width: `${(it.count / max) * 100}%` }} /></span>
              <span className="toplist-count">{it.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sinceLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function AttentionPanel({ data }: { data: Insights }) {
  const { deny, ipFlags, expiring, activeSessions } = data;
  return (
    <div className="card attention">
      <div className="card-head"><div className="ch-title"><h2>Attention</h2><span className="sub">security &amp; ops</span></div></div>

      <div className="attention-block">
        <div className="attention-k">Denials (30d)</div>
        <div className="attention-v">{deny.total}</div>
        {deny.reasons.map((r) => <div key={r.label} className="cell-sub">{r.label} · {r.count}</div>)}
      </div>

      <div className="attention-block">
        <div className="attention-k">IP-diversity flags</div>
        {ipFlags.length === 0 ? <div className="cell-sub">None</div> : ipFlags.map((f) => (
          <div key={f.userEmail} className="cell-sub"><span className="pill warn">{f.ipCount} IPs</span> {f.userEmail}</div>
        ))}
      </div>

      <div className="attention-block">
        <div className="attention-k">Grants expiring (7d)</div>
        <div className="attention-v">{expiring.count}</div>
        {expiring.soonest.map((g, i) => <div key={i} className="cell-sub">{g.userEmail} → {g.siteName}</div>)}
      </div>

      <div className="attention-block">
        <div className="attention-k">Active sessions</div>
        <div className="attention-v">{activeSessions.count}</div>
        {activeSessions.longestStartedAt && <div className="cell-sub">longest: {sinceLabel(activeSessions.longestStartedAt)}</div>}
      </div>
    </div>
  );
}

export function InsightsPanel({ data }: { data: Insights }) {
  return (
    <div className="insights">
      <TrendChart trend={data.trend} />
      <div className="insights-grid">
        <Heatmap heatmap={data.heatmap} />
        <AttentionPanel data={data} />
      </div>
      <div className="insights-grid">
        <TopList title="Top resources" items={data.topResources} empty="No resource access yet." />
        <TopList title="Top vendors" items={data.topVendors} empty="No vendor access yet." />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles to `src/app/(app)/globals.css`**

Append:

```css
/* Dashboard insights */
.insights { display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem; }
.insights-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 820px) { .insights-grid { grid-template-columns: 1fr; } }

.trend-chart { width: 100%; height: 120px; display: block; }
.trend-allow { fill: var(--ok); }
.trend-deny { fill: var(--danger); }
.chart-legend { display: flex; align-items: center; gap: .4rem; margin-top: .5rem; font-size: .8rem; color: var(--muted, #888); }
.chart-legend .dot { width: .6rem; height: .6rem; border-radius: 50%; display: inline-block; }
.chart-legend .dot.ok { background: var(--ok); }
.chart-legend .dot.danger { background: var(--danger); }

.heatmap { display: flex; flex-direction: column; gap: 2px; }
.heatmap-row { display: grid; grid-template-columns: 2.5rem repeat(24, 1fr); gap: 2px; align-items: center; }
.heatmap-day { font-size: .72rem; color: var(--muted, #888); }
.heatmap-cell { height: 12px; border-radius: 2px; background: var(--ok); }
.heatmap-axis { display: grid; grid-template-columns: 2.5rem repeat(4, 1fr); font-size: .68rem; color: var(--muted, #888); margin-top: 2px; }

.toplist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
.toplist li { display: grid; grid-template-columns: 9rem 1fr 2.5rem; gap: .5rem; align-items: center; }
.toplist-bar { background: var(--surface-2, rgba(127,127,127,.12)); border-radius: 4px; height: .7rem; overflow: hidden; }
.toplist-bar > span { display: block; height: 100%; background: var(--accent, #42d19a); border-radius: 4px; }
.toplist-count { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted, #888); }

.attention-block { padding: .5rem 0; border-top: 1px solid var(--border, rgba(127,127,127,.15)); }
.attention-block:first-of-type { border-top: none; }
.attention-k { font-size: .8rem; color: var(--muted, #888); }
.attention-v { font-size: 1.4rem; font-weight: 600; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: Wire it into the home page (`src/app/(app)/page.tsx`)**

Add the import:

```tsx
import { getInsights } from "@/lib/dashboard/insights";
import { InsightsPanel } from "./_dashboard/insights-panel";
```

Add `getInsights()` to the admin `Promise.all` and render the panel. Change:

```tsx
  const [stats, siteHealth, activity] = await Promise.all([getDashboardStats(), getSiteHealth(), getRecentActivity()]);
```

to:

```tsx
  const [stats, siteHealth, activity, insights] = await Promise.all([getDashboardStats(), getSiteHealth(), getRecentActivity(), getInsights()]);
```

and, in the returned JSX, insert `<InsightsPanel>` right after `<StatCards s={stats} />`:

```tsx
      <StatCards s={stats} />
      <InsightsPanel data={insights} />
      <div className="dash-cols">
```

- [ ] **Step 4: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/_dashboard/insights-panel.tsx" "src/app/(app)/globals.css" "src/app/(app)/page.tsx"
git commit -m "feat(dashboard): Insights section — trend, heatmap, top lists, attention panel"
```

- [ ] **Step 6: Gate A — live validation (operator, after deploy)**

Manual acceptance, after deploy (bump `access-manager`; no migrate). On the admin
home (`/`), below the stat cards, the Insights section renders:
1. **Access (30 days)** — allow (teal) / deny (red) daily bars with the 30-day totals.
2. **When vendors connect** — a day×hour heatmap that lights up where access happened.
3. **Top resources** + **Top vendors** — horizontal-bar lists.
4. **Attention** — denials + top reasons, any IP-diversity flags, grants expiring
   in 7 days, and active sessions (with the longest running).
A fresh install shows tasteful empty states (no crash, no NaN).

---

## Self-Review

**1. Spec coverage:**
- Pure helpers `buildTrend/buildHeatmap/topBy/denyReasons/ipFlags` + `IP_FLAG_THRESHOLD` → Task 1. ✓
- `getInsights()` (one 30d fetch + expiring grants + active sessions, fail-soft) → Task 2. ✓
- `InsightsPanel` inline-SVG components (TrendChart/Heatmap/TopList/AttentionPanel) + CSS + home wiring → Task 3. ✓
- Fixed 30-day window, UTC bucketing, admin-only (renders only in the admin branch) → Tasks 1–3. ✓
- Empty states, fail-soft active sessions, no schema/dep/raw-SQL → Global Constraints + Tasks. ✓
- Testing (5 pure-helper unit tests; Gate A) → Task 1 + Task 3. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is concrete. The two untested tasks (getInsights orchestration, presentational panel) state the justification, matching the repo's untested-route/component pattern.

**3. Type consistency:**
- `AuditRow` / `TrendDay` / `Labeled` / `IpFlag` (Task 1) are consumed with those exact shapes by `getInsights` (Task 2) and `InsightsPanel` (Task 3). ✓
- `Insights` fields (`trend`, `heatmap.{grid,max}`, `topResources`, `topVendors`, `deny.{total,reasons}`, `ipFlags`, `expiring.{count,soonest}`, `activeSessions.{count,longestStartedAt}`) — produced in Task 2, rendered field-for-field in Task 3. ✓
- `listActiveSessions()` returns `ActiveSession[]` with `startedAt: string` (existing) — used for `count` + `longestStartedAt` in Task 2. ✓
- Helper signatures (`topBy(rows, "siteName"|"userEmail", limit)`, `denyReasons(rows, limit)`, `ipFlags(rows, threshold)`) match their calls in `getInsights`. ✓
