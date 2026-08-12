# Security Console Home Implementation Plan (Slice 2a-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin home with a #2a Security Console (KPI band + live-session cards + pending/expiring/connectors/audit grid) and relocate the Insights analytics dashboard to `/admin/insights`.

**Architecture:** A `getConsoleData()` server aggregator gathers everything from existing helpers; a server `SecurityConsole` component renders the #2a layout using theme tokens (dark-default, teal); pure formatters handle durations. The home page renders the console when set up (keeping the getting-started checklist otherwise); Insights moves to its own page + a new top-nav item.

**Tech Stack:** Next.js App Router (server components + one existing client button), React, Prisma (read-only), Vitest, TypeScript.

## Global Constraints

- English-only UI copy. No Turkish.
- No database schema change. No new backend actions — **Terminate** (live session) and **Extend** (grant) are out of scope; live cards show **Watch** only; Expiring is read-only.
- No Claude signature/trailer in commits.
- Theme-aware: use app tokens (`--bg`, `--surface`, `--surface-2`, `--line`, `--fg`, `--muted`, `--faint`, `--accent`, `--nav-accent`, `--mono`, `--warn`, `--danger`, `--ok`). Never hardcode #2a's `#0a0f1a` hex.
- Reuse existing helpers: `listActiveSessions()` (`{ sessionId, siteId, userId, protocol, host, startedAt, viewerCount, controlOwner }`), `listPendingGrants()` (`{ id, startsAt, endsAt, note, createdAt, schedule, user:{name,email}, site:{name,hostname} }`), `countPendingGrants()`, `getRecentActivity(limit)` (`ActivityRow = { id, decision, userEmail, siteName, host, path, timestamp }`), `recordingEnabled()`, `requireCapability(cap)`, `DecisionButtons({ grantId })` from `src/app/(app)/admin/grants/decision-buttons.tsx`.
- Test runner: `pnpm test -- <path>` (vitest, colocated `*.test.ts`). Build gate: `pnpm build`.

---

### Task 1: Console formatters (pure)

**Files:**
- Create: `src/lib/console/format.ts`
- Test: `src/lib/console/format.test.ts`

**Interfaces:**
- Produces: `duration(startISO: string, now: Date): string`, `expiresIn(endISO: string, now: Date): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/console/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { duration, expiresIn } from "./format";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("duration", () => {
  it("minutes only", () => expect(duration("2026-08-12T11:55:00Z", NOW)).toBe("5m"));
  it("hours + zero-padded minutes", () => expect(duration("2026-08-12T10:55:00Z", NOW)).toBe("1h 05m"));
  it("just started", () => expect(duration("2026-08-12T12:00:00Z", NOW)).toBe("0m"));
});

describe("expiresIn", () => {
  it("more than an hour", () => expect(expiresIn("2026-08-13T02:16:00Z", NOW)).toBe("14h 16m"));
  it("under an hour", () => expect(expiresIn("2026-08-12T12:30:00Z", NOW)).toBe("under 1h"));
  it("already past → under 1h (clamped)", () => expect(expiresIn("2026-08-12T11:55:00Z", NOW)).toBe("under 1h"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/console/format.test.ts`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 3: Write the implementation**

`src/lib/console/format.ts`:

```ts
// "5m" / "1h 05m" — elapsed time since a session started.
export function duration(startISO: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(startISO).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// "14h 16m" / "under 1h" — time left until a grant's window closes.
export function expiresIn(endISO: string, now: Date): string {
  const mins = Math.floor((new Date(endISO).getTime() - now.getTime()) / 60000);
  if (mins < 60) return "under 1h";
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/lib/console/format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/console/format.ts src/lib/console/format.test.ts
git commit -m "feat(console): duration + expiresIn formatters"
```

---

### Task 2: Console data aggregator

**Files:**
- Create: `src/lib/console/data.ts`

**Interfaces:**
- Consumes: the reuse helpers listed in Global Constraints.
- Produces: `ConsoleData`, `ConsoleKpis`, `LiveCard`, `PendingCard`, `ExpiringRow`, `ConnectorRow`, `ConsoleAuditRow`, `getConsoleData(): Promise<ConsoleData>`.

- [ ] **Step 1: Write the aggregator**

Create `src/lib/console/data.ts`:

```ts
import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/dataplane/client";
import { countPendingGrants, listPendingGrants } from "@/lib/access/grants";
import { getRecentActivity } from "@/lib/dashboard/stats";
import { recordingEnabled } from "@/lib/recording/enabled";

export type ConsoleAuditRow = Awaited<ReturnType<typeof getRecentActivity>>[number];

export interface ConsoleKpis { grants: number; live: number; pending: number; expiring24h: number; recordings7d: number }
export interface LiveCard { sessionId: string; protocol: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number }
export interface PendingCard { id: string; userLabel: string; siteName: string; detail: string }
export interface ExpiringRow { id: string; userLabel: string; siteName: string; endsAt: string }
export interface ConnectorRow { id: string; name: string; online: boolean }
export interface ConsoleData {
  kpis: ConsoleKpis;
  live: LiveCard[];
  pending: PendingCard[];
  expiring: ExpiringRow[];
  connectors: ConnectorRow[];
  audit: ConsoleAuditRow[];
}

// Read-only snapshot for the security console home. Reuses existing helpers;
// listActiveSessions() already fails soft to [] when the data-plane is down.
export async function getConsoleData(): Promise<ConsoleData> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const recEnabled = recordingEnabled();

  const [grants, pending, expiring24h, recordings7d, sessions, pendingRows, expiringRows, connectors, audit] = await Promise.all([
    db.accessGrant.count({ where: { status: "ACTIVE" } }),
    countPendingGrants(),
    db.accessGrant.count({ where: { status: "ACTIVE", endsAt: { gt: now, lte: in24h } } }),
    db.sessionRecording.count({ where: { startedAt: { gte: weekAgo } } }),
    listActiveSessions(),
    listPendingGrants(),
    db.accessGrant.findMany({
      where: { status: "ACTIVE", endsAt: { gt: now, lte: in24h } },
      orderBy: { endsAt: "asc" }, take: 6,
      select: { id: true, endsAt: true, user: { select: { name: true, email: true } }, site: { select: { name: true } } },
    }),
    db.connector.findMany({ where: { status: { not: "REVOKED" } }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    getRecentActivity(6),
  ]);

  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const siteIds = [...new Set(sessions.map((s) => s.siteId))];
  const [users, sites] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    recEnabled && siteIds.length ? db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, recordSessions: true } }) : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u.name || u.email]));
  const recMap = new Map(sites.map((s) => [s.id, s.recordSessions]));

  const live: LiveCard[] = sessions.map((s) => ({
    sessionId: s.sessionId, protocol: s.protocol, host: s.host,
    userLabel: userMap.get(s.userId) ?? "unknown", startedAt: s.startedAt,
    recorded: recEnabled && (recMap.get(s.siteId) ?? false), viewerCount: s.viewerCount,
  }));

  return {
    kpis: { grants, live: sessions.length, pending, expiring24h, recordings7d },
    live,
    pending: pendingRows.map((p) => ({ id: p.id, userLabel: p.user.name || p.user.email, siteName: p.site.name, detail: p.note ?? "" })),
    expiring: expiringRows.map((e) => ({ id: e.id, userLabel: e.user.name || e.user.email, siteName: e.site.name, endsAt: (e.endsAt as Date).toISOString() })),
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, online: c.status === "ONLINE" })),
    audit,
  };
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully (aggregator exists but is not yet used — fine).

> If the build flags a Prisma field name (e.g. `sessionRecording`, `startedAt`, `connector.status`), open `packages`/the schema or an existing query and match the real field; these names come from existing queries (`listRecordings` uses `sessionRecording.startedAt`; `getDashboardStats` uses `connector.status: "ONLINE"`), so they should match.

- [ ] **Step 3: Commit**

```bash
git add src/lib/console/data.ts
git commit -m "feat(console): getConsoleData aggregator"
```

---

### Task 3: SecurityConsole component + styles

**Files:**
- Create: `src/app/(app)/_console/security-console.tsx`
- Modify: `src/app/globals.css` (append `.sc-*`)

**Interfaces:**
- Consumes: `ConsoleData` (Task 2), `duration`/`expiresIn` (Task 1), `DecisionButtons`.
- Produces: `SecurityConsole({ data }: { data: ConsoleData })` server component. Not yet rendered (Task 4).

- [ ] **Step 1: Write the component**

Create `src/app/(app)/_console/security-console.tsx`:

```tsx
import Link from "next/link";
import type { ConsoleData } from "@/lib/console/data";
import { duration, expiresIn } from "@/lib/console/format";
import { DecisionButtons } from "@/app/(app)/admin/grants/decision-buttons";

function hhmm(ts: Date | string): string {
  return new Date(ts).toISOString().slice(11, 16);
}
function auditMsg(r: ConsoleData["audit"][number]): string {
  const who = r.userEmail ?? "—";
  const what = r.siteName ?? r.host ?? r.path ?? "";
  return `${who} · ${r.decision} · ${what}`.trim();
}

export function SecurityConsole({ data }: { data: ConsoleData }) {
  const now = new Date();
  const { kpis, live, pending, expiring, connectors, audit } = data;
  const cells: { label: string; value: number; tone: string }[] = [
    { label: "GRANTS", value: kpis.grants, tone: "" },
    { label: "LIVE", value: kpis.live, tone: "accent" },
    { label: "PENDING", value: kpis.pending, tone: "warn" },
    { label: "EXPIRING 24H", value: kpis.expiring24h, tone: "danger" },
    { label: "RECORDINGS 7D", value: kpis.recordings7d, tone: "" },
  ];

  return (
    <div className="sc">
      <div className="sc-kpis">
        {cells.map((c) => (
          <div key={c.label} className="sc-kpi">
            <div className="sc-kpi-label">{c.label}</div>
            <div className={`sc-kpi-value${c.tone ? " " + c.tone : ""}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <section className="sc-block">
        <div className="sc-head"><h2>Live sessions</h2><Link href="/admin/live" className="sc-more">All sessions →</Link></div>
        {live.length === 0 ? (
          <div className="sc-empty">No live sessions.</div>
        ) : (
          <div className="sc-live">
            {live.map((s) => (
              <div key={s.sessionId} className="sc-card">
                <div className="sc-card-top">
                  <span className="sc-chip">{s.protocol.toUpperCase()}</span>
                  {s.recorded && <span className="sc-rec"><span className="sc-dot" />REC {duration(s.startedAt, now)}</span>}
                </div>
                <div className="sc-card-name">{s.host}</div>
                <div className="sc-card-sub">{s.userLabel}{s.viewerCount > 0 ? ` · ${s.viewerCount} watching` : ""}</div>
                <div className="sc-thumb">live session</div>
                <Link href={`/live/${s.sessionId}`} className="sc-watch">Watch live</Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="sc-grid">
        <div className="sc-panel">
          <div className="sc-head"><h2>Pending requests</h2>{pending.length > 0 && <span className="sc-count">{pending.length}</span>}</div>
          {pending.length === 0 ? <div className="sc-empty">Nothing waiting.</div> : pending.map((p) => (
            <div key={p.id} className="sc-req">
              <div className="sc-req-t">{p.userLabel} → {p.siteName}</div>
              {p.detail && <div className="sc-req-d">{p.detail}</div>}
              <DecisionButtons grantId={p.id} />
            </div>
          ))}
        </div>

        <div className="sc-col">
          <div className="sc-panel">
            <div className="sc-head"><h2>Expiring soon</h2></div>
            {expiring.length === 0 ? <div className="sc-empty">Nothing expiring.</div> : expiring.map((e) => (
              <Link key={e.id} href="/admin/grants" className="sc-exp">
                <span className="sc-exp-t">{e.userLabel} → {e.siteName}</span>
                <span className="sc-exp-left">{expiresIn(e.endsAt, now)}</span>
              </Link>
            ))}
          </div>
          <div className="sc-panel">
            <div className="sc-head"><h2>Connectors</h2></div>
            {connectors.length === 0 ? <div className="sc-empty">No connectors.</div> : connectors.map((c) => (
              <div key={c.id} className="sc-conn">
                <span className={`sc-dot ${c.online ? "ok" : "down"}`} />
                <span className="sc-conn-name">{c.name}</span>
                <span className="sc-conn-state">{c.online ? "online" : "offline"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sc-panel">
          <div className="sc-head"><h2>Audit stream</h2></div>
          {audit.length === 0 ? <div className="sc-empty">No recent activity.</div> : audit.map((r) => (
            <div key={r.id} className="sc-audit">
              <span className="sc-audit-t">{hhmm(r.timestamp)}</span>
              <span className={`sc-audit-k ${r.decision === "ALLOW" ? "ok" : "deny"}`}>{r.decision}</span>
              <span className="sc-audit-m">{auditMsg(r)}</span>
            </div>
          ))}
          <div className="sc-morefoot"><Link href="/admin/audit" className="sc-more">Full audit log →</Link></div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append the console styles**

Append to `src/app/globals.css` (new `/* Security console */` section, theme-token based):

```css
/* Security console */
.sc { display: flex; flex-direction: column; gap: 24px; }
.sc-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.sc-kpi { background: var(--surface); padding: 16px 20px; }
.sc-kpi-label { font: 500 10px/1 var(--mono); letter-spacing: .12em; color: var(--muted); }
.sc-kpi-value { font: 600 26px/1 var(--mono); color: var(--fg); margin-top: 8px; }
.sc-kpi-value.accent { color: var(--nav-accent); } .sc-kpi-value.warn { color: var(--warn); } .sc-kpi-value.danger { color: var(--danger); }
.sc-block { display: flex; flex-direction: column; gap: 12px; }
.sc-head { display: flex; align-items: center; justify-content: space-between; }
.sc-head h2 { font-size: .95rem; font-weight: 600; margin: 0; color: var(--fg); }
.sc-more { font-size: .8rem; color: var(--nav-accent); text-decoration: none; }
.sc-count { font: 600 .7rem var(--mono); color: var(--warn); background: var(--warn-soft); border-radius: 99px; padding: 2px 9px; }
.sc-empty { color: var(--muted); font-size: .85rem; padding: 6px 0; }
.sc-live { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.sc-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.sc-card:hover { border-color: var(--accent); }
.sc-card-top { display: flex; align-items: center; justify-content: space-between; }
.sc-chip { font: 600 11px var(--mono); color: var(--fg); background: var(--surface-2); border-radius: 5px; padding: 3px 9px; }
.sc-rec { display: flex; align-items: center; gap: 6px; font: 600 10px var(--mono); color: var(--danger); letter-spacing: .08em; }
.sc-card-name { font-size: .95rem; font-weight: 600; color: var(--fg); }
.sc-card-sub { font: 400 12px var(--mono); color: var(--muted); }
.sc-thumb { height: 40px; border-radius: 8px; background: repeating-linear-gradient(90deg,var(--surface-2) 0 6px,var(--surface) 6px 12px); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; font: 400 10px var(--mono); color: var(--faint); }
.sc-watch { text-align: center; font: 600 12px var(--sans, inherit); color: var(--accent-fg); background: var(--accent); border-radius: 7px; padding: 7px 0; text-decoration: none; }
.sc-grid { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 14px; align-items: start; }
.sc-col { display: flex; flex-direction: column; gap: 14px; }
.sc-panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
.sc-req { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.sc-req-t { font-size: .88rem; color: var(--fg); } .sc-req-d { font: 400 11px var(--mono); color: var(--muted); }
.sc-exp { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; text-decoration: none; }
.sc-exp-t { font-size: .82rem; color: var(--fg); } .sc-exp-left { font: 600 12px var(--mono); color: var(--danger); white-space: nowrap; }
.sc-conn { display: flex; align-items: center; gap: 10px; font: 400 12px var(--mono); }
.sc-conn-name { color: var(--muted); flex: 1; } .sc-conn-state { color: var(--faint); }
.sc-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: var(--danger); }
.sc-dot.ok { background: var(--nav-accent); } .sc-dot.down { background: var(--warn); }
.sc-audit { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line-soft, var(--line)); font: 400 12px var(--mono); }
.sc-audit-t { color: var(--faint); flex: 0 0 auto; } .sc-audit-k { flex: 0 0 auto; width: 52px; } .sc-audit-k.ok { color: var(--nav-accent); } .sc-audit-k.deny { color: var(--danger); }
.sc-audit-m { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-morefoot { padding-top: 6px; }
@media (max-width: 900px) { .sc-kpis { grid-template-columns: repeat(2, 1fr); } .sc-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/_console/security-console.tsx" src/app/globals.css
git commit -m "feat(console): SecurityConsole component + styles"
```

---

### Task 4: Relocate Insights + wire the console home

**Files:**
- Create: `src/app/(app)/admin/insights/page.tsx`
- Modify: `src/lib/nav/model.ts`, `src/lib/nav/model.test.ts`, `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `SecurityConsole` (Task 3), `getConsoleData` (Task 2).

- [ ] **Step 1: Create the relocated Insights page**

Create `src/app/(app)/admin/insights/page.tsx`:

```tsx
import { requireCapability } from "@/lib/current-user";
import { getDashboardStats, getSiteHealth, getRecentActivity } from "@/lib/dashboard/stats";
import { getInsights } from "@/lib/dashboard/insights";
import { DashboardInsights } from "../../_dashboard/dashboard-insights";
import { SiteHealthPanel } from "../../_dashboard/site-health-panel";
import { RecentActivityPanel } from "../../_dashboard/recent-activity-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  await requireCapability("read_console");
  const [stats, siteHealth, activity, insights] = await Promise.all([
    getDashboardStats(), getSiteHealth(), getRecentActivity(), getInsights(),
  ]);
  return (
    <main>
      <div className="page-head"><div><h1>Insights</h1></div></div>
      <DashboardInsights stats={stats} insights={insights} />
      <div className="dash-cols">
        <SiteHealthPanel sites={siteHealth} />
        <RecentActivityPanel events={activity} />
      </div>
    </main>
  );
}
```

> Confirm the import shapes match the current home before writing: open `src/app/(app)/page.tsx` and copy the exact `<DashboardInsights .../>`, `<SiteHealthPanel .../>`, `<RecentActivityPanel .../>` prop usage (the home renders them today, so mirror it verbatim). Adjust prop names if they differ from `stats`/`insights`/`sites`/`events`.

- [ ] **Step 2: Add "Insights" to the nav model + update its test**

In `src/lib/nav/model.ts`, add the Insights item right after the Audit push:

```ts
  if (read) primary.push({ label: "Audit", href: "/admin/audit" });
  if (read) primary.push({ label: "Insights", href: "/admin/insights" });
```

In `src/lib/nav/model.test.ts`, update the three primary-label expectations to include `"Insights"`:

```ts
    // ADMIN
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Recordings", "Audit", "Insights"]);
    // OPERATOR
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Audit", "Insights"]);
    // AUDITOR
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Audit", "Insights"]);
```

Run: `pnpm test -- src/lib/nav/model.test.ts`
Expected: PASS (4 tests, updated).

- [ ] **Step 3: Render the console on the home**

In `src/app/(app)/page.tsx`:

**Imports** — remove the four Insights imports now living on `/admin/insights`:
```
import { getDashboardStats, getSiteHealth, getRecentActivity } from "@/lib/dashboard/stats";  // keep getSetupStatus (see below)
import { getInsights } from "@/lib/dashboard/insights";
import { DashboardInsights } from "./_dashboard/dashboard-insights";
import { SiteHealthPanel } from "./_dashboard/site-health-panel";
import { RecentActivityPanel } from "./_dashboard/recent-activity-panel";
```
`getSetupStatus` is imported from the same `@/lib/dashboard/stats` line as the removed helpers — keep `getSetupStatus`, drop `getDashboardStats, getSiteHealth, getRecentActivity` from that import. Remove the `getInsights` and the three `_dashboard/*` component imports entirely. Then add:
```tsx
import { getConsoleData } from "@/lib/console/data";
import { SecurityConsole } from "./_console/security-console";
```

**Body** — the admin branch today ends with this block (after `allDone` is true):
```tsx
  const [stats, siteHealth, activity, insights] = await Promise.all([getDashboardStats(), getSiteHealth(), getRecentActivity(), getInsights()]);

  const conns = await db.connector.findMany({ where: { status: { not: "REVOKED" } }, select: { version: true } });
  const mgr = managerVersion();
  const outdated = conns.filter((c) => isConnectorOutdated(c.version, mgr)).length;

  return (
    <main>
      {head}
      {outdated > 0 && (
        <div className="notice">
          {outdated} connector{outdated === 1 ? "" : "s"} … <Link href="/admin/connectors">Review →</Link>
        </div>
      )}
      <DashboardInsights stats={stats} insights={insights} />
      <div className="dash-cols">
        <SiteHealthPanel sites={siteHealth} />
        <RecentActivityPanel events={activity} />
      </div>
    </main>
  );
```
Change it to: delete the `const [stats, …] = await Promise.all(...)` line; keep the `conns`/`mgr`/`outdated` computation and the `{outdated > 0 && …}` notice verbatim; add `const data = await getConsoleData();`; replace the `<DashboardInsights/>` + `<div className="dash-cols">…</div>` with `<SecurityConsole data={data} />`:
```tsx
  const conns = await db.connector.findMany({ where: { status: { not: "REVOKED" } }, select: { version: true } });
  const mgr = managerVersion();
  const outdated = conns.filter((c) => isConnectorOutdated(c.version, mgr)).length;
  const data = await getConsoleData();

  return (
    <main>
      {head}
      {outdated > 0 && (
        <div className="notice">
          {outdated} connector{outdated === 1 ? "" : "s"} … <Link href="/admin/connectors">Review →</Link>
        </div>
      )}
      <SecurityConsole data={data} />
    </main>
  );
```
The getting-started checklist branch (when `!allDone`) and everything above it are unchanged. `db`, `managerVersion`, `isConnectorOutdated`, `Link`, `getSetupStatus` imports stay (still used).

- [ ] **Step 4: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully. (Any leftover unused import from the removed Insights block will fail the build — remove it.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/insights/page.tsx" src/lib/nav/model.ts src/lib/nav/model.test.ts "src/app/(app)/page.tsx"
git commit -m "feat(console): security console home; relocate Insights to /admin/insights"
```

---

### Task 5: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite** — Run: `pnpm test` → PASS (existing + format + updated nav-model).
- [ ] **Step 2: Production build** — Run: `pnpm build` → Compiles successfully.
- [ ] **Step 3: Manual test matrix (record results; deploy is a separate user-approved step — do not deploy here):**

1. ADMIN home shows the 5 KPIs with correct counts; LIVE teal, PENDING amber, EXPIRING red.
2. A live session (open one) appears as a card with protocol/host/user + Watch → `/live/{id}`; REC shows only for recorded resources; empty state otherwise.
3. Pending request Approve/Deny works and PENDING decrements on reload.
4. Expiring rows show countdown + link to Grants; Connectors show online/offline dots; Audit stream lists recent events with ALLOW/DENY colour + "Full audit log →".
5. Top-nav "Insights" opens `/admin/insights` showing the old charts + site health + recent activity; the item is gated to read_console.
6. A fresh install (no connectors/sites/grants) still shows the getting-started checklist, not an empty console.
7. Light theme renders the console correctly (no hardcoded dark).
8. OPERATOR/AUDITOR see the console + Insights (read_console); no crash on any panel with empty data.

---

## Notes for the implementer

- `SecurityConsole` is a server component; `DecisionButtons` (client) renders inside it unchanged.
- Do not build Terminate/Extend or any new API route — this slice is presentation over existing data + one relocation.
- Keep the console theme-token based; verify `--warn`/`--danger`/`--nav-accent`/`--surface-2`/`--faint`/`--line-soft` exist in `:root` (they were listed in the token dump); if `--line-soft` is absent, the `.sc-audit` border falls back to `--line` via the declared fallback.
