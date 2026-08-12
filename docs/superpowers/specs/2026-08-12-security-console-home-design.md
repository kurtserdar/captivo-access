# Security Console Home — Design (Slice 2a-2)

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** 2a-2 of the dashboard redesign — replace the admin home with the #2a **Security Console** (operational security posture + actions), and relocate the current Insights analytics dashboard to its own page. The top-nav shell (2a-1) is already live. Design reference: `#2a` in `/home/jhum/Dashboard Alternatifleri.dc.html` + README.

## Problem

The admin home (`/`, `src/app/(app)/page.tsx` admin branch) currently renders the **Insights** analytics dashboard (Recharts charts, heatmap, KPI strip — `src/app/(app)/_dashboard/`). The #2a design calls for an operational **Security Console**: live sessions, pending requests, expiring grants, connector health, and an audit stream, so an admin lands on "what needs attention now" rather than analytics. This slice builds that console and moves Insights to `/admin/insights`.

## Scope

- **In:** a Security Console home (KPI band + live-session cards + bottom grid), a `getConsoleData()` aggregator + pure formatters (tested), the Insights dashboard relocated to `/admin/insights`, an "Insights" top-nav item, and the getting-started checklist preserved for fresh installs.
- **Out (deferred):** **Terminate** a live gateway session and **Extend** a grant — neither backend action exists today; building them is a separate slice. Live cards show **Watch** only; Expiring soon is a read-only list linking to Grants.
- **Theme-aware:** build with the app's existing tokens (`--bg`, `--surface`, `--surface-2`, `--nav-bg`, `--accent`, `--nav-accent`, `--line`, `--muted`, `--mono`, status `--ok`/`--warn`/`--danger`). #2a is the visual reference; do **not** hardcode its `#0a0f1a` palette (would break light theme). Dark-default already matches #2a's intent.
- **English-only. No schema change. No Claude signature.**

## Decision resolved

- **Insights → `/admin/insights`** (relocate, not discard); home `/` becomes the console. A new **"Insights"** primary item is added to the top-nav (read_console), after "Audit".
- **Watch-only + read-only Expiring** (Terminate/Extend deferred).

## Data

A server aggregator `getConsoleData()` (`src/lib/console/data.ts`) returns everything the console needs, scoped/read-only, reusing existing helpers:

```ts
export interface ConsoleKpis { grants: number; live: number; pending: number; expiring24h: number; recordings7d: number }
export interface LiveCard { sessionId: string; protocol: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number }
export interface PendingCard { id: string; userLabel: string; siteName: string; detail: string }
export interface ExpiringRow { id: string; userLabel: string; siteName: string; endsAt: string }
export interface ConnectorRow { id: string; name: string; online: boolean }
export interface AuditRow { t: string; msg: string }      // reuse getRecentActivity() output
export interface ConsoleData {
  kpis: ConsoleKpis;
  live: LiveCard[];
  pending: PendingCard[];
  expiring: ExpiringRow[];
  connectors: ConnectorRow[];
  audit: AuditRow[];
}
export async function getConsoleData(): Promise<ConsoleData>;
```

Sources:
- **KPIs:** `grants` = `db.accessGrant.count({ status: ACTIVE })`; `live` = `listActiveSessions().length`; `pending` = `countPendingGrants()`; `expiring24h` = `db.accessGrant.count({ status: ACTIVE, endsAt in (now, now+24h] })`; `recordings7d` = `db.sessionRecording.count({ startedAt >= now-7d })`.
- **live:** `listActiveSessions()` (`{ sessionId, siteId, userId, protocol, host, startedAt, viewerCount }`), user id→name map (`db.user.findMany` as `/admin/live` does), `recorded` from a siteId→`recordSessions` map gated by `recordingEnabled()`.
- **pending:** `listPendingGrants()` → `{ id, userLabel: user.name||email, siteName: site.name, detail: note||"" }`.
- **expiring:** `db.accessGrant.findMany({ status: ACTIVE, endsAt in (now, now+24h], take 6, select user/site/endsAt })`.
- **connectors:** `db.connector.findMany({ status != REVOKED, select id/name/status })` → `online = status === "ONLINE"` (status-only; no latency).
- **audit:** `getRecentActivity(6)` (already `{ t, msg }`).

Pure formatters `src/lib/console/format.ts` (unit-tested): `duration(startISO, now)` → "1h 05m"; `expiresIn(endISO, now)` → "14h 16m" / "under 1h".

## Components

- **`src/lib/console/format.ts`** (new, pure, tested): `duration`, `expiresIn`.
- **`src/lib/console/data.ts`** (new): `getConsoleData()` aggregator (server; not unit-tested, like `getDashboardStats`).
- **`src/app/(app)/_console/security-console.tsx`** (new, server): renders the #2a layout from `ConsoleData`:
  - **KPI band** — 5 cells (GRANTS / LIVE / PENDING / EXPIRING 24H / RECORDINGS 7D); value tone: default, LIVE accent, PENDING warn, EXPIRING danger.
  - **Live sessions** — responsive card grid: protocol chip, REC duration (if `recorded`), resource `host`, `userLabel`, a live-thumbnail placeholder, and a **Watch** link (`/live/${sessionId}`). Empty state: "No live sessions."
  - **Bottom grid** (`1fr 1fr 1.3fr`): **Pending requests** (each row + `DecisionButtons` Approve/Deny) · **Expiring soon** (rows, red countdown, link to `/admin/grants`) + **Connectors** (status dot + name) · **Audit stream** (time + message rows, "Full audit log →" to `/admin/audit`).
  - `DecisionButtons` (existing client component) is reused for Approve/Deny.
- **`src/app/(app)/admin/insights/page.tsx`** (new): the relocated analytics — lift the current home's Insights rendering (`DashboardInsights` + `SiteHealthPanel` + `RecentActivityPanel`) and its data calls (`getDashboardStats`, `getSiteHealth`, `getRecentActivity`, `getInsights`); `requireCapability("read_console")`; `metadata.title = "Insights"`.
- **`src/app/(app)/page.tsx`** (modify): admin branch keeps the getting-started checklist + outdated-connector notice; when set up, render `<SecurityConsole data={await getConsoleData()} />` instead of the Insights block. Non-console redirect + operator/auditor copy unchanged.
- **`src/lib/nav/model.ts`** (modify): add `{ label: "Insights", href: "/admin/insights" }` to `primary` after "Audit" (read_console gate). Update `model.test.ts` expectations.
- **`src/app/globals.css`**: add a `/* Security console */` section (`.sc-*` classes) using theme tokens.

## Error / empty states

- No live sessions / no pending / no expiring / no connectors / no audit → each panel shows a muted empty line; the console never errors on empty data.
- `listActiveSessions()` already fails soft to `[]` if the data-plane is unreachable — the LIVE KPI and cards then show 0 / empty (no crash).

## Testing

- **Unit** (`vitest`): `src/lib/console/format.test.ts` — `duration` (minutes-only, hours+minutes, zero) and `expiresIn` (>1h, under 1h, clamped at 0); `src/lib/nav/model.test.ts` — updated to include "Insights" in ADMIN/OPERATOR/AUDITOR primary.
- **Build gate:** `pnpm build`.
- **Manual:** admin with a live session sees the console (KPIs correct, live card + Watch works); pending Approve/Deny works and decrements PENDING on reload; expiring rows link to Grants; connectors show online/offline dots; audit stream shows recent events; `/admin/insights` shows the old charts and is reachable from the top-nav "Insights" item; a fresh install still shows the getting-started checklist; light theme renders correctly.

## Out of scope (future slices)

- Terminate a live session; Extend a grant (backend actions).
- Header live-sessions pill (optional polish).
- Portal Requests/History; gateway file-transfer audit trail.
