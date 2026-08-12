# Portal Requests & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the vendor portal's Requests and History pages and expand its nav to three items.

**Architecture:** Two new server pages under the existing light `(portal)` shell, reusing the grant + recording data layers. A pure `requestStatus` classifies requests; a client `PortalNav` gives path-aware tabs; History pages via a self-scoped GET route.

**Tech Stack:** Next.js App Router (server pages + one client component + one API route), Prisma (read-only), Vitest, TypeScript.

## Global Constraints

- English-only. No Claude signature/trailer in commits. No schema change. Deploy = **manager only**.
- Light theme, `vp-*` classes (theme-independent, matching the portal). History shows **metadata only** — never a recording-playback link. The history route is **self-scoped**: it reads the caller's own `userId`, never a client-supplied one.
- Reuse: `RequestAccessButton()` (no props) and `WithdrawRequestButton({ id })` from `src/app/(portal)/access/`; `listRecordings(filter)` → `{ rows: RecordingRow[]; total }` where `RecordingRow = { id, siteId, userId, host, startedAt: Date, lastEventAt: Date, protocol: string|null, ... }`; `getCurrentUser()`/`requireUser()`.
- Test runner: `pnpm test -- <path>` (vitest). Build gate: `pnpm build`.

---

### Task 1: requestStatus helper

**Files:**
- Create: `src/lib/portal/request-status.ts`
- Test: `src/lib/portal/request-status.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/portal/request-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { requestStatus } from "./request-status";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("requestStatus", () => {
  it("DENIED → denied", () => expect(requestStatus({ status: "DENIED", approvedAt: null, endsAt: null }, NOW)).toBe("denied"));
  it("REVOKED → withdrawn", () => expect(requestStatus({ status: "REVOKED", approvedAt: "2026-08-11T00:00:00Z", endsAt: null }, NOW)).toBe("withdrawn"));
  it("no approval → pending", () => expect(requestStatus({ status: "ACTIVE", approvedAt: null, endsAt: null }, NOW)).toBe("pending"));
  it("approved + past end → expired", () => expect(requestStatus({ status: "ACTIVE", approvedAt: "2026-08-10T00:00:00Z", endsAt: "2026-08-11T00:00:00Z" }, NOW)).toBe("expired"));
  it("approved + future/no end → approved", () => {
    expect(requestStatus({ status: "ACTIVE", approvedAt: "2026-08-10T00:00:00Z", endsAt: "2026-08-20T00:00:00Z" }, NOW)).toBe("approved");
    expect(requestStatus({ status: "ACTIVE", approvedAt: "2026-08-10T00:00:00Z", endsAt: null }, NOW)).toBe("approved");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm test -- src/lib/portal/request-status.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/lib/portal/request-status.ts`:

```ts
export type RequestState = "pending" | "approved" | "denied" | "withdrawn" | "expired";

// Classifies a self-service access request from its grant fields.
export function requestStatus(
  g: { status: string; approvedAt: string | null; endsAt: string | null },
  now: Date,
): RequestState {
  if (g.status === "DENIED") return "denied";
  if (g.status === "REVOKED") return "withdrawn";
  if (!g.approvedAt) return "pending";
  if (g.endsAt && new Date(g.endsAt).getTime() < now.getTime()) return "expired";
  return "approved";
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `pnpm test -- src/lib/portal/request-status.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/request-status.ts src/lib/portal/request-status.test.ts
git commit -m "feat(portal): requestStatus classifier"
```

---

### Task 2: listUserRequests query + PortalNav

**Files:**
- Modify: `src/lib/access/grants.ts` (add `listUserRequests`)
- Create: `src/app/(portal)/_nav/portal-nav.tsx`
- Modify: `src/app/(portal)/layout.tsx`

**Interfaces:**
- Produces: `listUserRequests(userId: string)` → grants with `{ id, createdAt, startsAt, endsAt, status, approvedAt, denyReason, note, site: { name } }`; `PortalNav` client component.

- [ ] **Step 1: Add the query**

Append to `src/lib/access/grants.ts`:

```ts
export async function listUserRequests(userId: string) {
  return db.accessGrant.findMany({
    where: { userId, requiresApproval: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, createdAt: true, startsAt: true, endsAt: true,
      status: true, approvedAt: true, denyReason: true, note: true,
      site: { select: { name: true } },
    },
  });
}
```

- [ ] **Step 2: Create PortalNav**

Create `src/app/(portal)/_nav/portal-nav.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/access", label: "My access" },
  { href: "/requests", label: "Requests" },
  { href: "/history", label: "History" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link key={l.href} href={l.href} className={active ? "vp-navlink vp-navlink-active" : "vp-navlink"}>
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Wire it into the layout**

In `src/app/(portal)/layout.tsx`, add `import { PortalNav } from "./_nav/portal-nav";` and replace the hardcoded nav contents:

```tsx
        <nav className="vp-navlinks">
          <Link href="/access" className="vp-navlink vp-navlink-active">My access</Link>
        </nav>
```
with:
```tsx
        <nav className="vp-navlinks">
          <PortalNav />
        </nav>
```
If `Link` becomes unused in the layout after this, remove its import.

- [ ] **Step 4: Verify it builds** — Run: `pnpm build` → Compiles. (`/access` now shows a three-item nav; `/requests` and `/history` 404 until Tasks 3–4.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/access/grants.ts "src/app/(portal)/_nav/portal-nav.tsx" "src/app/(portal)/layout.tsx"
git commit -m "feat(portal): three-item nav + listUserRequests query"
```

---

### Task 3: Requests page

**Files:**
- Create: `src/app/(portal)/requests/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `listUserRequests` (Task 2), `requestStatus` (Task 1), `RequestAccessButton`, `WithdrawRequestButton`.

- [ ] **Step 1: Create the page**

Create `src/app/(portal)/requests/page.tsx`:

```tsx
import { requireUser } from "@/lib/current-user";
import { listUserRequests } from "@/lib/access/grants";
import { requestStatus, type RequestState } from "@/lib/portal/request-status";
import { RequestAccessButton } from "../access/request-access-button";
import { WithdrawRequestButton } from "../access/withdraw-request-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

const BADGE: Record<RequestState, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "amber" },
  approved: { label: "Approved", cls: "teal" },
  denied: { label: "Denied", cls: "red" },
  withdrawn: { label: "Withdrawn", cls: "gray" },
  expired: { label: "Expired", cls: "gray" },
};

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}

export default async function RequestsPage() {
  const user = await requireUser();
  const now = new Date();
  const rows = await listUserRequests(user.id);
  return (
    <div className="vp-home">
      <div className="vp-head">
        <div>
          <h1 className="vp-greet">Access requests</h1>
          <p className="vp-sub">Your access requests and their status.</p>
        </div>
        <RequestAccessButton />
      </div>
      {rows.length === 0 ? (
        <div className="vp-empty">You haven&apos;t requested any access yet.</div>
      ) : (
        <div className="vp-cards">
          {rows.map((r) => {
            const st = requestStatus(
              { status: r.status, approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null, endsAt: r.endsAt ? r.endsAt.toISOString() : null },
              now,
            );
            const b = BADGE[st];
            const reason = st === "denied" ? r.denyReason : r.note;
            return (
              <div key={r.id} className="vp-req">
                <div className="vp-req-top">
                  <div className="vp-req-id">
                    <span className="vp-req-name">{r.site.name}</span>
                    <span className={`vp-badge ${b.cls}`}>{b.label}</span>
                  </div>
                  {st === "pending" && <WithdrawRequestButton id={r.id} />}
                </div>
                <div className="vp-req-meta">Requested {fmtDate(r.createdAt)}{reason ? ` · ${reason}` : ""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Styles**

Append to the `/* Vendor portal — My access home */` area in `src/app/globals.css`:

```css
.vp-req { background: #fff; border: 1px solid #eceae6; border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; }
.vp-req-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.vp-req-id { display: flex; align-items: center; gap: 10px; }
.vp-req-name { font: 700 15px var(--font-public-sans), sans-serif; color: #1c1917; }
.vp-req-meta { font-size: 13px; color: #78716c; }
.vp-badge { font: 600 11px var(--font-plex-mono), monospace; border-radius: 99px; padding: 2px 10px; }
.vp-badge.amber { background: #fff7ed; color: #b45309; }
.vp-badge.teal { background: #f0fdfa; color: #0f766e; }
.vp-badge.red { background: #fef2f2; color: #b91c1c; }
.vp-badge.gray { background: #f5f5f4; color: #78716c; }
```

- [ ] **Step 3: Verify it builds** — Run: `pnpm build` → Compiles.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(portal)/requests/page.tsx" src/app/globals.css
git commit -m "feat(portal): Requests page"
```

---

### Task 4: History page + self-scoped route

**Files:**
- Create: `src/lib/portal/history.ts`, `src/app/api/portal/history/route.ts`, `src/app/(portal)/history/history-list.tsx`, `src/app/(portal)/history/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `listRecordings`, `getCurrentUser`/`requireUser`, `db`.
- Produces: `HistoryRowJSON`, `historyPage(userId, offset, limit?)`, `HISTORY_PAGE_SIZE`.

- [ ] **Step 1: The shared row builder**

Create `src/lib/portal/history.ts`:

```ts
import { db } from "@/lib/db";
import { listRecordings } from "@/lib/recording/query";

export const HISTORY_PAGE_SIZE = 20;

export interface HistoryRowJSON {
  id: string;
  name: string;
  protocol: string;
  date: string;         // ISO
  durationText: string; // "42m" / "1h 12m"
}

function durationText(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m`;
}

// A page of the given user's own session history, resource names resolved.
export async function historyPage(userId: string, offset: number, limit = HISTORY_PAGE_SIZE): Promise<HistoryRowJSON[]> {
  const { rows } = await listRecordings({ userId, limit, offset });
  const siteIds = [...new Set(rows.map((r) => r.siteId))];
  const sites = siteIds.length ? await db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(sites.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id,
    name: nameById.get(r.siteId) ?? r.host,
    protocol: r.protocol ?? "",
    date: r.startedAt.toISOString(),
    durationText: durationText(r.startedAt, r.lastEventAt),
  }));
}
```

- [ ] **Step 2: The self-scoped route**

Create `src/app/api/portal/history/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { historyPage } from "@/lib/portal/history";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = new URL(req.url).searchParams.get("offset") ?? "0";
  const offset = Math.max(0, Number.parseInt(raw, 10) || 0);
  const rows = await historyPage(user.id, offset);
  return NextResponse.json({ rows });
}
```

- [ ] **Step 3: The client list**

Create `src/app/(portal)/history/history-list.tsx`:

```tsx
"use client";
import { useState } from "react";
import type { HistoryRowJSON } from "@/lib/portal/history";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

export function HistoryList({ initial, pageSize }: { initial: HistoryRowJSON[]; pageSize: number }) {
  const [rows, setRows] = useState<HistoryRowJSON[]>(initial);
  const [done, setDone] = useState(initial.length < pageSize);
  const [busy, setBusy] = useState(false);

  async function loadMore() {
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/history?offset=${rows.length}`);
      const data = (await res.json()) as { rows: HistoryRowJSON[] };
      setRows((r) => [...r, ...data.rows]);
      if (data.rows.length < pageSize) setDone(true);
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  if (rows.length === 0) return <div className="vp-empty">No sessions yet.</div>;
  return (
    <div className="vp-railcard">
      {rows.map((r) => (
        <div key={r.id} className="vp-recent">
          <span className="vp-recent-name">{r.name}{r.protocol ? ` · ${r.protocol.toUpperCase()}` : ""}</span>
          <span className="vp-recent-meta">{fmtDate(r.date)} · {r.durationText}</span>
        </div>
      ))}
      {!done && (
        <button type="button" className="vp-loadmore" disabled={busy} onClick={loadMore}>
          {busy ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: The page**

Create `src/app/(portal)/history/page.tsx`:

```tsx
import { requireUser } from "@/lib/current-user";
import { historyPage, HISTORY_PAGE_SIZE } from "@/lib/portal/history";
import { HistoryList } from "./history-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "History" };

export default async function HistoryPage() {
  const user = await requireUser();
  const initial = await historyPage(user.id, 0);
  return (
    <div className="vp-home">
      <div className="vp-head">
        <div>
          <h1 className="vp-greet">Session history</h1>
          <p className="vp-sub">Your past remote sessions.</p>
        </div>
      </div>
      <HistoryList initial={initial} pageSize={HISTORY_PAGE_SIZE} />
    </div>
  );
}
```

- [ ] **Step 5: Style the Load-more**

Append to `src/app/globals.css`:

```css
.vp-loadmore { align-self: flex-start; margin-top: 8px; background: #f5f5f4; color: #1c1917; border: 1px solid #eceae6; border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.vp-loadmore:hover { background: #eceae6; }
.vp-loadmore:disabled { opacity: .6; cursor: default; }
```

- [ ] **Step 6: Verify it builds** — Run: `pnpm build` → Compiles.

- [ ] **Step 7: Commit**

```bash
git add src/lib/portal/history.ts "src/app/api/portal/history/route.ts" "src/app/(portal)/history" src/app/globals.css
git commit -m "feat(portal): History page + self-scoped load-more route"
```

---

### Task 5: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (existing + request-status test).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Manual (Gate A):** as a vendor — the nav shows My access · Requests · History and highlights the current one; Requests lists your requests with correct badges (pending/approved/denied/withdrawn/expired) and Withdraw only on pending; withdrawing removes it; History lists your past sessions with correct duration and Load more pages further; `GET /api/portal/history` returns only your own sessions (self-scoped); empty states render; light theme correct.

---

## Notes for the implementer

- Deploy is **manager only** (no schema/data-plane change) — a separate, user-approved step.
- The history route must resolve `userId` from the session (`getCurrentUser`), never from a query param — a vendor must not be able to read another user's history.
- `RequestAccessButton`/`WithdrawRequestButton` are existing client components under `(portal)/access/`; import them by relative path from the new pages.
