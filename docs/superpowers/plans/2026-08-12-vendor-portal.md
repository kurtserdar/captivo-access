# Vendor Portal — "My access" Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give connect-only (vendor) users a dedicated light-themed portal whose home is a redesigned "My access" screen — granted resources with time-remaining bars, a security-status summary, upcoming windows, and recent sessions.

**Architecture:** A new `(portal)` route group with its own light shell holds the relocated `/access` route. The home reuses the existing grant pipeline (`listUserGrants` → `classifyGrant`) plus per-user `listRecordings`, formatted by three pure, unit-tested helpers. Connect-only users are redirected there from the app root.

**Tech Stack:** Next.js App Router (route groups, server components), React, Prisma (read-only), next/font (Public Sans), Vitest, TypeScript.

## Global Constraints

- English-only UI copy. No Turkish.
- No database schema change.
- No Claude signature/trailer in commits.
- Terminology: "vendor" (role stays `VENDOR`).
- Test runner: `pnpm test -- <path>` (vitest, colocated `*.test.ts`, `import { describe, it, expect } from "vitest"`).
- Build/typecheck gate: `pnpm build`.
- Portal is light-only and theme-independent — style with explicit hex tokens, never the app's theme CSS variables.
- **Light palette (verbatim):** page `#fcfcfb`, card `#fff`, subtle `#f5f5f4`, border `#eceae6`, hairline `#fafaf9`; text primary `#1c1917`, secondary `#57534e`, tertiary `#78716c`, muted `#a8a29e`; brand teal-700 `#0f766e`, teal-400 `#2dd4bf`, teal-100 `#99f6e4`, teal-50 `#f0fdfa`; status recording `#dc2626`, amber `#b45309`. Brand line `linear-gradient(90deg,#0f766e,#2dd4bf 40%,#0f766e)`.
- Existing helpers to reuse (do not reimplement): `listUserGrants(userId)` → grants with `{ id, startsAt, endsAt, status, requiresApproval, approvedAt, schedule, denyReason, site:{ id, name, hostname, recordSessions, logoType, accessMode } }`; `classifyGrant(g, now)` → `"allow" | "not_yet" | "off_schedule" | "pending_approval" | "denied" | ...`; `listRecordings(filter)` → `{ rows: RecordingRow[] }` where `RecordingRow = { id, siteId, host, startedAt, lastEventAt, protocol, ... }`; `recordingEnabled()` → boolean; `RequestAccessButton` (client component).

---

### Task 1: Pure formatting helpers

**Files:**
- Create: `src/lib/portal/time-remaining.ts`, `src/lib/portal/security-status.ts`, `src/lib/portal/launch-href.ts`
- Test: `src/lib/portal/time-remaining.test.ts`, `src/lib/portal/security-status.test.ts`, `src/lib/portal/launch-href.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `remaining(startISO: string|null, endISO: string|null, schedule: string|null, now: Date): { text: string; pct: number; tone: "urgent"|"ok"|"schedule" }`
  - `securityStatus(input: { hasPasskey: boolean; anyRecorded: boolean }): { label: string; tone: "good"|"info"|"muted" }[]`
  - `launchHref(accessMode: string, siteId: string, hostname: string): string`

- [ ] **Step 1: Write the failing tests**

`src/lib/portal/time-remaining.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { remaining } from "./time-remaining";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("remaining", () => {
  it("permanent grant (no start/end): ok, no bar", () => {
    expect(remaining(null, null, null, NOW)).toEqual({ text: "Permanent", pct: 0, tone: "ok" });
  });
  it("schedule-bound (no fixed end): schedule tone", () => {
    const r = remaining(null, null, "business-hours", NOW);
    expect(r.tone).toBe("schedule");
    expect(r.pct).toBe(0);
  });
  it("ends in <24h: urgent", () => {
    const start = new Date("2026-08-12T00:00:00Z").toISOString(); // 12h ago
    const end = new Date("2026-08-13T00:00:00Z").toISOString();   // in 12h
    const r = remaining(start, end, null, NOW);
    expect(r.tone).toBe("urgent");
    expect(r.pct).toBe(50);            // half the 24h window elapsed
    expect(r.text).toContain("left");
  });
  it("ends in >24h: ok", () => {
    const start = new Date("2026-08-12T00:00:00Z").toISOString();
    const end = new Date("2026-08-15T00:00:00Z").toISOString();   // in 3d
    const r = remaining(start, end, null, NOW);
    expect(r.tone).toBe("ok");
    expect(r.pct).toBeGreaterThan(0);
    expect(r.pct).toBeLessThan(100);
  });
  it("past end: 100% elapsed, clamped", () => {
    const start = new Date("2026-08-10T00:00:00Z").toISOString();
    const end = new Date("2026-08-11T00:00:00Z").toISOString();
    expect(remaining(start, end, null, NOW).pct).toBe(100);
  });
});
```

`src/lib/portal/security-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { securityStatus } from "./security-status";

describe("securityStatus", () => {
  it("passkey + recorded", () => {
    expect(securityStatus({ hasPasskey: true, anyRecorded: true })).toEqual([
      { label: "Passkey enabled", tone: "good" },
      { label: "Sessions recorded & audited", tone: "info" },
      { label: "No VPN required", tone: "muted" },
    ]);
  });
  it("no passkey, not recorded", () => {
    expect(securityStatus({ hasPasskey: false, anyRecorded: false })).toEqual([
      { label: "Passkey not set up", tone: "muted" },
      { label: "No VPN required", tone: "muted" },
    ]);
  });
});
```

`src/lib/portal/launch-href.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { launchHref } from "./launch-href";

describe("launchHref", () => {
  it("GATEWAY → native session page", () => {
    expect(launchHref("GATEWAY", "site123", "10.0.0.1:3389")).toBe("/gateway/site123/session");
  });
  it("web (TRANSPARENT) → https host", () => {
    expect(launchHref("TRANSPARENT", "site123", "app.internal")).toBe("https://app.internal");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/lib/portal/`
Expected: FAIL — cannot resolve the three modules.

- [ ] **Step 3: Write the implementations**

`src/lib/portal/launch-href.ts`:

```ts
// Where the "Open" button on an access card points. GATEWAY resources open the
// in-Captivo native session page; web (TRANSPARENT) resources open directly.
// Extracted verbatim from the retired access-view.tsx.
export function launchHref(accessMode: string, siteId: string, hostname: string): string {
  return accessMode === "GATEWAY" ? `/gateway/${siteId}/session` : `https://${hostname}`;
}
```

`src/lib/portal/security-status.ts`:

```ts
export interface StatusLine {
  label: string;
  tone: "good" | "info" | "muted";
}

// Derives the vendor's security-status lines from real account state. No fake
// timestamps: passkey reflects enrollment, recording reflects whether any granted
// resource is recorded, VPN-less is a product constant.
export function securityStatus(input: { hasPasskey: boolean; anyRecorded: boolean }): StatusLine[] {
  const lines: StatusLine[] = [];
  lines.push(input.hasPasskey
    ? { label: "Passkey enabled", tone: "good" }
    : { label: "Passkey not set up", tone: "muted" });
  if (input.anyRecorded) lines.push({ label: "Sessions recorded & audited", tone: "info" });
  lines.push({ label: "No VPN required", tone: "muted" });
  return lines;
}
```

`src/lib/portal/time-remaining.ts`:

```ts
export interface Remaining {
  text: string;
  pct: number; // 0–100, percentage of the window elapsed
  tone: "urgent" | "ok" | "schedule";
}

// Humanizes a millisecond span, e.g. "14h 16m left", "2d 20h left".
function humanize(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function remaining(startISO: string | null, endISO: string | null, schedule: string | null, now: Date): Remaining {
  if (!endISO) {
    if (schedule) return { text: "Scheduled window", pct: 0, tone: "schedule" };
    return { text: "Permanent", pct: 0, tone: "ok" };
  }
  const end = new Date(endISO).getTime();
  const start = startISO ? new Date(startISO).getTime() : now.getTime();
  const n = now.getTime();
  const total = Math.max(1, end - start);
  const elapsed = Math.min(total, Math.max(0, n - start));
  const pct = Math.round((elapsed / total) * 100);
  const msLeft = end - n;
  const tone: Remaining["tone"] = msLeft < 24 * 3600 * 1000 ? "urgent" : "ok";
  return { text: humanize(msLeft), pct, tone };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/lib/portal/`
Expected: PASS (all three files).

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal/
git commit -m "feat(portal): time-remaining, security-status, launch-href helpers"
```

---

### Task 2: Portal route group + light shell (relocate /access)

**Files:**
- Create: `src/app/(portal)/layout.tsx`
- Move (git mv): `src/app/(app)/access/` → `src/app/(portal)/access/` (page.tsx, access-view.tsx, request-access-button.tsx, request-access-form.tsx, withdraw-request-button.tsx — whatever exists there)
- Modify: `src/app/layout.tsx` (add Public Sans font), `src/app/globals.css` (portal shell styles), `src/app/(app)/page.tsx` (non-console branch → redirect)

**Interfaces:**
- Consumes: existing `requireUser()` from `@/lib/current-user`, existing `LogoutButton` (find its path under `(app)` — currently `src/app/(app)/logout-button.tsx`; import it directly by relative path from the portal layout).
- Produces: a working `/access` route rendered inside the new light shell (still showing the existing page content — redesign is Task 3).

- [ ] **Step 1: Add Public Sans to the root font setup**

In `src/app/layout.tsx`, extend the next/font import and add the variable:

```tsx
import { IBM_Plex_Sans, IBM_Plex_Mono, Public_Sans } from "next/font/google";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-plex-mono", display: "swap" });
const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-public-sans", display: "swap" });
```

Add `publicSans.variable` to the `<html>` className:

```tsx
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${publicSans.variable}`}>
```

- [ ] **Step 2: Relocate the access route into a new (portal) group**

```bash
mkdir -p "src/app/(portal)"
git mv "src/app/(app)/access" "src/app/(portal)/access"
```

- [ ] **Step 3: Create the portal shell layout**

Create `src/app/(portal)/layout.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { LogoutButton } from "../(app)/logout-button";

export const dynamic = "force-dynamic";

// Light, self-contained shell for connect-only (vendor) users. No admin sidebar.
// Theme-independent: explicit light palette, Public Sans.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const initials = (user.name ?? user.email ?? "?").trim().slice(0, 2).toUpperCase();
  return (
    <div className="vp-root">
      <div className="vp-brandline" />
      <header className="vp-nav">
        <div className="vp-brand">
          <div className="vp-logo">C</div>
          <span className="vp-word">Captivo <span className="vp-word-sub">ACCESS</span></span>
        </div>
        <nav className="vp-navlinks">
          <Link href="/access" className="vp-navlink vp-navlink-active">My access</Link>
        </nav>
        <div className="vp-navright">
          <div className="vp-avatar">{initials}</div>
          <LogoutButton />
        </div>
      </header>
      <div className="vp-body">{children}</div>
    </div>
  );
}
```

> If `LogoutButton` is not a named export at that path, open `src/app/(app)/logout-button.tsx`, match its actual export (default vs named), and import accordingly.

- [ ] **Step 4: Add portal shell styles**

Append to `src/app/globals.css` (a new section; `vp-` prefixed so nothing collides):

```css
/* Vendor portal (light, theme-independent) */
.vp-root { min-height: 100vh; background: #fcfcfb; color: #1c1917; font-family: var(--font-public-sans), sans-serif; }
.vp-brandline { height: 3px; background: linear-gradient(90deg,#0f766e,#2dd4bf 40%,#0f766e); }
.vp-nav { display: flex; align-items: center; gap: 24px; height: 64px; padding: 0 48px; border-bottom: 1px solid #eceae6; }
.vp-brand { display: flex; align-items: center; gap: 10px; }
.vp-logo { width: 28px; height: 28px; border-radius: 8px; background: #0f766e; color: #fff; display: flex; align-items: center; justify-content: center; font: 700 14px var(--font-plex-mono), monospace; }
.vp-word { font: 700 15px var(--font-public-sans), sans-serif; color: #1c1917; }
.vp-word-sub { color: #a8a29e; font-weight: 500; font-size: 11px; letter-spacing: .12em; }
.vp-navlinks { display: flex; gap: 24px; }
.vp-navlink { font-size: 14px; color: #78716c; text-decoration: none; }
.vp-navlink-active { color: #1c1917; font-weight: 600; }
.vp-navright { margin-left: auto; display: flex; align-items: center; gap: 16px; }
.vp-avatar { width: 30px; height: 30px; border-radius: 50%; background: #e7e5e4; color: #57534e; display: flex; align-items: center; justify-content: center; font: 600 12px var(--font-public-sans), sans-serif; }
.vp-body { max-width: 1080px; margin: 0 auto; padding: 48px 24px 64px; }
```

- [ ] **Step 5: Redirect connect-only users to the portal**

In `src/app/(app)/page.tsx`, replace the entire `if (!isConsoleUser(user.role)) { ... }` block body (the card that says "You have N active grants…") with a redirect. Add `import { redirect } from "next/navigation";` at the top if absent:

```tsx
  if (!isConsoleUser(user.role)) {
    redirect("/access");
  }
```

Leave the `user.role !== "ADMIN"` (operator/auditor) and admin branches unchanged.

- [ ] **Step 6: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully. `/access` now renders the existing page content inside the light portal shell; connect-only users landing on `/` are redirected to it.

- [ ] **Step 7: Commit**

```bash
git add src/app/layout.tsx "src/app/(portal)" src/app/globals.css "src/app/(app)/page.tsx"
git rm -r --cached "src/app/(app)/access" 2>/dev/null || true
git commit -m "feat(portal): light portal shell + relocate /access; redirect connect-only users"
```

---

### Task 3: Redesign /access into the #2b home

**Files:**
- Rewrite: `src/app/(portal)/access/page.tsx`
- Create: `src/app/(portal)/access/portal-home.tsx`
- Delete: `src/app/(portal)/access/access-view.tsx`
- Modify: `src/app/globals.css` (portal home styles)

**Interfaces:**
- Consumes: `listUserGrants`, `classifyGrant`, `recordingEnabled`, `listRecordings`, `remaining`, `securityStatus`, `launchHref`, `RequestAccessButton`; `db.passkey.count`.
- Produces: the finished vendor home. No exports other than the default page + `PortalHome`.

- [ ] **Step 1: Rewrite the page to gather data and render PortalHome**

Replace the entire contents of `src/app/(portal)/access/page.tsx`:

```tsx
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { listUserGrants } from "@/lib/access/grants";
import { classifyGrant } from "@/lib/access/evaluate";
import { recordingEnabled } from "@/lib/recording/enabled";
import { listRecordings } from "@/lib/recording/query";
import { remaining } from "@/lib/portal/time-remaining";
import { securityStatus } from "@/lib/portal/security-status";
import { launchHref } from "@/lib/portal/launch-href";
import { PortalHome, type CardVM, type RecentVM } from "./portal-home";

export const dynamic = "force-dynamic";
export const metadata = { title: "My access" };

export default async function AccessPage() {
  const user = await requireUser();
  const now = new Date();
  const recEnabled = recordingEnabled();

  const [grants, passkeyCount, recentRes] = await Promise.all([
    listUserGrants(user.id),
    db.passkey.count({ where: { userId: user.id } }),
    listRecordings({ userId: user.id, limit: 3, offset: 0 }),
  ]);

  const cards: CardVM[] = [];
  const upcoming: CardVM[] = [];
  const siteName = new Map<string, string>();
  let anyRecorded = false;

  for (const g of grants) {
    const reason = classifyGrant(g, now);
    let status: CardVM["status"] | null = null;
    if (reason === "allow") status = "active";
    else if (reason === "not_yet") status = "upcoming";
    else if (reason === "off_schedule") status = "off_hours";
    else if (reason === "pending_approval") status = "pending";
    else if (reason === "denied") status = "denied";
    if (!status) continue; // expired/revoked not shown

    siteName.set(g.site.id, g.site.name);
    const recorded = recEnabled && g.site.recordSessions;
    if (recorded) anyRecorded = true;

    const startISO = g.startsAt ? g.startsAt.toISOString() : null;
    const endISO = g.endsAt ? g.endsAt.toISOString() : null;
    const card: CardVM = {
      id: g.id,
      siteName: g.site.name,
      hostname: g.site.hostname ?? "",
      accessMode: g.site.accessMode,
      hasLogo: g.site.logoType != null,
      siteId: g.site.id,
      glyph: g.site.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "··",
      status,
      denyReason: g.denyReason ?? null,
      href: launchHref(g.site.accessMode, g.site.id, g.site.hostname ?? ""),
      time: remaining(startISO, endISO, g.schedule ?? null, now),
    };
    if (status === "upcoming") {
      card.whenText = g.startsAt ? formatWhen(g.startsAt) : "Scheduled";
      upcoming.push(card);
    } else cards.push(card);
  }

  const recent: RecentVM[] = recentRes.rows.map((r) => ({
    id: r.id,
    name: siteName.get(r.siteId) ?? r.host,
    protocol: r.protocol ?? "",
    durationText: durationText(r.startedAt, r.lastEventAt),
  }));

  const security = securityStatus({ hasPasskey: passkeyCount > 0, anyRecorded });
  const activeCount = cards.filter((c) => c.status === "active").length;

  return (
    <PortalHome
      firstName={(user.name ?? "").split(" ")[0] || "there"}
      activeCount={activeCount}
      anyRecorded={anyRecorded}
      cards={cards}
      upcoming={upcoming}
      recent={recent}
      security={security}
    />
  );
}

function durationText(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m`;
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d) + " UTC";
}
```

- [ ] **Step 2: Create the PortalHome presentation**

Create `src/app/(portal)/access/portal-home.tsx`:

```tsx
import { RequestAccessButton } from "./request-access-button";
import type { Remaining } from "@/lib/portal/time-remaining";
import type { StatusLine } from "@/lib/portal/security-status";

export interface CardVM {
  id: string;
  siteName: string;
  hostname: string;
  accessMode: string;
  hasLogo: boolean;
  siteId: string;
  glyph: string;
  status: "active" | "upcoming" | "off_hours" | "pending" | "denied";
  denyReason: string | null;
  href: string;
  time: Remaining;
  whenText?: string; // upcoming cards only: formatted start, e.g. "Aug 14, 09:00"
}
export interface RecentVM { id: string; name: string; protocol: string; durationText: string; }

const TONE_COLOR: Record<Remaining["tone"], string> = { urgent: "#b45309", ok: "#0f766e", schedule: "#78716c" };
const STATUS_DOT: Record<StatusLine["tone"], string> = { good: "#0f766e", info: "#dc2626", muted: "#a8a29e" };

export function PortalHome(props: {
  firstName: string; activeCount: number; anyRecorded: boolean;
  cards: CardVM[]; upcoming: CardVM[]; recent: RecentVM[]; security: StatusLine[];
}) {
  const { firstName, activeCount, anyRecorded, cards, upcoming, recent, security } = props;
  return (
    <div className="vp-home">
      <div className="vp-head">
        <div>
          <h1 className="vp-greet">Welcome back, {firstName}</h1>
          <p className="vp-sub">{activeCount} active grant{activeCount === 1 ? "" : "s"}{anyRecorded ? " · all sessions on this workspace are recorded" : ""}</p>
        </div>
        <RequestAccessButton />
      </div>

      <div className="vp-grid">
        <div className="vp-cards">
          {cards.length === 0 ? (
            <div className="vp-empty">You don&apos;t have any access yet.</div>
          ) : cards.map((c) => (
            <div key={c.id} className="vp-card">
              <div className="vp-card-top">
                <div className="vp-icon">
                  {c.hasLogo ? <img src={`/api/sites/${c.siteId}/logo`} alt="" width={44} height={44} className="vp-icon-img" /> : c.glyph}
                </div>
                <div className="vp-card-id">
                  <div className="vp-card-title"><span className="vp-card-name">{c.siteName}</span><span className="vp-chip">{c.accessMode === "GATEWAY" ? "REMOTE" : "WEB"}</span></div>
                  <div className="vp-card-host">{c.hostname}</div>
                </div>
                {c.status === "active"
                  ? <a className="vp-open" href={c.href} target="_blank" rel="noopener noreferrer">Open ↗</a>
                  : <span className="vp-open vp-open-off">{c.status === "pending" ? "Pending" : c.status === "off_hours" ? "Off hours" : c.status === "denied" ? "Denied" : "—"}</span>}
              </div>
              <div className="vp-meter">
                <div className="vp-meter-row"><span className="vp-meter-label">{c.status === "denied" ? (c.denyReason ?? "Not available") : "Access window"}</span><span className="vp-meter-remain" style={{ color: TONE_COLOR[c.time.tone] }}>{c.time.text}</span></div>
                <div className="vp-bar"><div className="vp-bar-fill" style={{ width: `${c.time.pct}%`, background: TONE_COLOR[c.time.tone] }} /></div>
              </div>
            </div>
          ))}
        </div>

        <div className="vp-rail">
          <div className="vp-railcard">
            <div className="vp-railtitle">Security status</div>
            {security.map((s, i) => (
              <div key={i} className="vp-statusline"><span className="vp-dot" style={{ background: STATUS_DOT[s.tone] }} />{s.label}</div>
            ))}
          </div>
          <div className="vp-railcard">
            <div className="vp-railtitle">Upcoming</div>
            {upcoming.length === 0 ? <div className="vp-muted">Nothing scheduled.</div> : upcoming.map((u) => (
              <div key={u.id} className="vp-upcoming"><div className="vp-upcoming-name">{u.siteName}</div><div className="vp-upcoming-when">{u.whenText ?? u.time.text}</div></div>
            ))}
          </div>
          <div className="vp-railcard">
            <div className="vp-railtitle">Recent sessions</div>
            {recent.length === 0 ? <div className="vp-muted">No sessions yet.</div> : recent.map((r) => (
              <div key={r.id} className="vp-recent"><span className="vp-recent-name">{r.name}</span><span className="vp-recent-meta">{r.durationText}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="vp-footer">Need something that isn&apos;t listed? Your request goes to the resource owner for approval.</div>
    </div>
  );
}
```

- [ ] **Step 3: Delete the retired view**

```bash
git rm "src/app/(portal)/access/access-view.tsx"
```

If `page.tsx` (old) imported anything else that is now unused, the build in Step 5 will flag it — remove those files/imports too.

- [ ] **Step 4: Add portal home styles**

Append to `src/app/globals.css` (after the shell styles from Task 2):

```css
.vp-home { display: flex; flex-direction: column; gap: 28px; }
.vp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.vp-greet { font: 800 30px var(--font-public-sans), sans-serif; color: #1c1917; letter-spacing: -.02em; margin: 0; }
.vp-sub { font-size: 15px; color: #78716c; margin: 6px 0 0; }
.vp-grid { display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start; }
.vp-cards { display: flex; flex-direction: column; gap: 16px; }
.vp-card { background: #fff; border: 1px solid #eceae6; border-radius: 16px; padding: 24px 28px; display: flex; flex-direction: column; gap: 18px; box-shadow: 0 1px 3px rgba(28,25,23,.04); }
.vp-card:hover { border-color: #99f6e4; }
.vp-card-top { display: flex; align-items: center; gap: 16px; }
.vp-icon { width: 44px; height: 44px; border-radius: 12px; background: #f0fdfa; color: #0f766e; display: flex; align-items: center; justify-content: center; font: 700 13px var(--font-plex-mono), monospace; overflow: hidden; flex-shrink: 0; }
.vp-icon-img { width: 44px; height: 44px; object-fit: cover; }
.vp-card-id { flex: 1; min-width: 0; }
.vp-card-title { display: flex; align-items: center; gap: 10px; }
.vp-card-name { font: 700 17px var(--font-public-sans), sans-serif; color: #1c1917; }
.vp-chip { font: 600 11px var(--font-plex-mono), monospace; background: #f5f5f4; color: #57534e; border-radius: 5px; padding: 2px 8px; }
.vp-card-host { font: 400 13px var(--font-plex-mono), monospace; color: #a8a29e; margin-top: 3px; }
.vp-open { background: #1c1917; color: #fff; font: 600 14px var(--font-public-sans), sans-serif; padding: 9px 20px; border-radius: 9px; text-decoration: none; white-space: nowrap; }
.vp-open-off { background: #f5f5f4; color: #a8a29e; }
.vp-meter { display: flex; flex-direction: column; gap: 8px; }
.vp-meter-row { display: flex; justify-content: space-between; font-size: 13px; }
.vp-meter-label { color: #78716c; }
.vp-meter-remain { font: 600 13px var(--font-plex-mono), monospace; }
.vp-bar { height: 6px; border-radius: 99px; background: #f5f5f4; overflow: hidden; }
.vp-bar-fill { height: 100%; border-radius: 99px; }
.vp-rail { display: flex; flex-direction: column; gap: 16px; }
.vp-railcard { background: #fff; border: 1px solid #eceae6; border-radius: 16px; padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; }
.vp-railtitle { font: 700 15px var(--font-public-sans), sans-serif; color: #1c1917; }
.vp-statusline { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #57534e; }
.vp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.vp-upcoming { border-left: 2px solid #99f6e4; padding-left: 12px; }
.vp-upcoming-name { font: 600 13px var(--font-public-sans), sans-serif; color: #1c1917; }
.vp-upcoming-when { font: 400 12px var(--font-plex-mono), monospace; color: #a8a29e; }
.vp-recent { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px solid #fafaf9; }
.vp-recent-name { color: #57534e; }
.vp-recent-meta { font: 400 12px var(--font-plex-mono), monospace; color: #a8a29e; }
.vp-muted { font-size: 13px; color: #a8a29e; }
.vp-empty { background: #fff; border: 1px solid #eceae6; border-radius: 16px; padding: 24px 28px; color: #78716c; font-size: 14px; }
.vp-footer { display: flex; align-items: center; background: #f5f5f4; border-radius: 14px; padding: 18px 24px; font-size: 14px; color: #57534e; }
```

- [ ] **Step 5: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

> Note on the `<img>` logo: if the build's lint fails on `next/image` preference for the raw `<img>`, keep the `<img>` (the logo route returns a dynamic per-tenant image and next/image adds no value here) by leaving the existing eslint posture; if the repo's lint blocks it, add `{/* eslint-disable-next-line @next/next/no-img-element */}` above the tag.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(portal)/access" src/app/globals.css
git commit -m "feat(portal): redesign My-access home to the #2b vendor layout"
```

---

### Task 4: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS (existing suite + the three new portal helper files).

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 3: Manual test matrix (record results; deploy is a separate user-approved step — do not deploy here)**

1. A `VENDOR` user signing in lands on `/access` rendered in the light portal shell (no admin sidebar).
2. Access cards show correct remaining text + bar fill; amber when <24h, teal otherwise, gray for schedule/permanent.
3. "Open ↗" opens active GATEWAY resources at `/gateway/{id}/session` and web resources at `https://{host}` in a new tab; non-active cards show a disabled state.
4. Right rail: Security status reflects passkey enrollment + recording; Upcoming lists future-window grants; Recent sessions lists the user's last sessions (or the empty line).
5. Empty states: a user with no grants sees the empty card + Request access; no upcoming / no recent show the muted lines.
6. A console (ADMIN) user visiting `/access` also sees the portal (their own grants); the admin dashboard at `/` is unchanged.
7. "Request access" opens the existing request flow and still works end-to-end.

---

## Notes for the implementer

- `(portal)` is a route group — the URL stays `/access`; there must be exactly one `/access` route after Task 2 (the old `(app)/access` is moved, not copied).
- The portal is light-only; never reference the app's theme CSS variables in `vp-` styles. Use the palette in Global Constraints.
- Reuse `RequestAccessButton` as-is; it moved with the route in Task 2.
- Do not build the "Requests" or "History" pages — the portal nav intentionally shows only "My access" this slice.
