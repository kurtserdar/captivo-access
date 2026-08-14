# Display Timezone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let dates/times across the console + portal display in a configured timezone — a global default set in Policy, overridable per user — falling back to the viewer's browser timezone when unset. Data stays UTC in the DB.

**Architecture:** Resolve a display timezone server-side per request (`user.timezone ?? platform.displayTimezone ?? null`), deliver it to the client via a `TimezoneProvider` context wrapping each layout, and format every date through the existing `LocalTime` component (now timezone-aware; `null` → browser TZ). A handful of direct date renders are converted to `LocalTime` for one consistent path.

**Tech Stack:** Next.js/TypeScript, Prisma. Manager-only + additive schema.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- DB timestamps stay UTC — this is display-only. Do not touch `format.ts` relative helpers or the per-grant schedule timezone (access logic).
- Backward compatible: timezone unset → browser TZ (today's behaviour).
- Additive schema → `prisma db push` (no `--accept-data-loss`).
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Schema — `User.timezone` + `PlatformSettings.displayTimezone`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the columns**

In `model User`, after `company String?`:

```prisma
  timezone       String? // per-user display timezone override (IANA); null = inherit
```

In `model PlatformSettings`, after `recordingConsentRequired`:

```prisma
  displayTimezone          String? // global display timezone (IANA); null = viewer's browser
```

- [ ] **Step 2: Regenerate + commit**

Run: `pnpm db:generate`
Expected: success.

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add User.timezone + PlatformSettings.displayTimezone"
```

---

### Task 2: Resolver — `resolvedDisplayTimezone`

**Files:**
- Modify: `src/lib/settings/platform.ts`
- Create: `src/lib/settings/timezone.ts`

**Interfaces:**
- Produces: `PlatformSettings.displayTimezone`; `resolvedDisplayTimezone(userId: string): Promise<string | null>`.

- [ ] **Step 1: Platform setting field**

In `src/lib/settings/platform.ts`: add `displayTimezone: string | null;` to the `PlatformSettings` interface; `displayTimezone: null,` to `EMPTY`; `displayTimezone: c?.displayTimezone ?? null,` to the loaded `s` object.

- [ ] **Step 2: Resolver**

Create `src/lib/settings/timezone.ts`:

```ts
import { db } from "@/lib/db";
import { getPlatformSettings } from "./platform";

// Resolved display timezone for a user: their own override, else the global
// default, else null (the client falls back to the viewer's browser timezone).
export async function resolvedDisplayTimezone(userId: string): Promise<string | null> {
  const [user, s] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    getPlatformSettings(),
  ]);
  return user?.timezone ?? s.displayTimezone ?? null;
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add src/lib/settings/platform.ts src/lib/settings/timezone.ts
git commit -m "feat(settings): displayTimezone platform setting + resolvedDisplayTimezone"
```

---

### Task 3: TimezoneProvider + timezone-aware LocalTime

**Files:**
- Create: `src/app/(app)/_shell/timezone-context.tsx`
- Modify: `src/app/(app)/_shell/local-time.tsx`

**Interfaces:**
- Produces: `TimezoneProvider`, `useTimezone(): string | null`; `LocalTime({ iso, mode? })`.

- [ ] **Step 1: Context**

Create `src/app/(app)/_shell/timezone-context.tsx`:

```tsx
"use client";
import { createContext, useContext } from "react";

const TimezoneContext = createContext<string | null>(null);

// Provides the resolved display timezone (or null → viewer's browser TZ) to client
// date components. Fed a server-resolved value at each layout root.
export function TimezoneProvider({ tz, children }: { tz: string | null; children: React.ReactNode }) {
  return <TimezoneContext.Provider value={tz}>{children}</TimezoneContext.Provider>;
}

export function useTimezone(): string | null {
  return useContext(TimezoneContext);
}
```

- [ ] **Step 2: LocalTime reads the context + `mode`**

Replace `src/app/(app)/_shell/local-time.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTimezone } from "./timezone-context";

const DATETIME: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
};
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

// Renders an ISO timestamp in the configured display timezone (from context), or the
// viewer's own browser timezone when none is set. The initial (SSR / first-hydration)
// value is deterministic — fixed en-GB + UTC — so it is identical on server and
// client (no hydration mismatch); a client-only effect then re-formats it.
export function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: "datetime" | "time" }) {
  const tz = useTimezone();
  const fmt = mode === "time" ? TIME : DATETIME;
  const [text, setText] = useState(() => new Date(iso).toLocaleString("en-GB", { ...fmt, timeZone: "UTC" }));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(new Date(iso).toLocaleString(undefined, tz ? { ...fmt, timeZone: tz } : fmt));
  }, [iso, tz, mode, fmt]);
  return (
    <time dateTime={iso} title={iso}>
      {text}
    </time>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success (existing `<LocalTime iso=…>` call sites still compile — `mode` is optional).

```bash
git add "src/app/(app)/_shell/timezone-context.tsx" "src/app/(app)/_shell/local-time.tsx"
git commit -m "feat(console): timezone-aware LocalTime + TimezoneProvider"
```

---

### Task 4: Wire the provider into both layouts

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(portal)/layout.tsx`

- [ ] **Step 1: (app) layout**

In `src/app/(app)/layout.tsx`, import the resolver + provider, resolve the TZ for the current user, and wrap the returned tree:

```tsx
import { resolvedDisplayTimezone } from "@/lib/settings/timezone";
import { TimezoneProvider } from "./_shell/timezone-context";
```

After `const user = await requireUser();`, add:

```tsx
  const tz = await resolvedDisplayTimezone(user.id);
```

Wrap the returned `<div className="app">…</div>` in `<TimezoneProvider tz={tz}>…</TimezoneProvider>`.

- [ ] **Step 2: (portal) layout**

In `src/app/(portal)/layout.tsx`, do the same: import `resolvedDisplayTimezone` + `TimezoneProvider` (path `@/app/(app)/_shell/timezone-context`), resolve `const tz = await resolvedDisplayTimezone(user.id);`, and wrap the returned `<div className="vp-root">…</div>` in `<TimezoneProvider tz={tz}>`.

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/(app)/layout.tsx" "src/app/(portal)/layout.tsx"
git commit -m "feat(console): provide resolved display timezone at both layout roots"
```

---

### Task 5: Sweep the direct date renders onto LocalTime

**Files:**
- Modify: `src/app/(app)/_console/security-console.tsx`
- Modify: `src/app/(app)/admin/audit/integrity-panel.tsx`
- Modify: `src/app/(app)/admin/audit/admin-integrity-panel.tsx`

- [ ] **Step 1: Console audit-stream time**

In `src/app/(app)/_console/security-console.tsx`, the audit stream renders `hhmm(r.at)` where `hhmm` is `new Date(ts).toISOString().slice(11, 16)` (hard UTC). Replace the `<span className="sc-audit-t">{hhmm(r.at)}</span>` with `<span className="sc-audit-t"><LocalTime iso={new Date(r.at).toISOString()} mode="time" /></span>`, import `LocalTime` from `@/app/(app)/_shell/local-time`, and remove the now-unused `hhmm` helper. (`r.at` is a Date or string — normalise via `new Date(r.at).toISOString()`.)

- [ ] **Step 2: Integrity panels**

In `src/app/(app)/admin/audit/integrity-panel.tsx` and `admin-integrity-panel.tsx`, replace the two `new Date(x.genTime).toLocaleString()` renders in each with `<LocalTime iso={new Date(x.genTime).toISOString()} />` (import `LocalTime`). Where `genTime` may be null, keep the `? … : "—"` guard. (If a panel is a plain string-concatenation context that can't take JSX, leave that one as `toLocaleString()` and note it — the table-cell renders take JSX.)

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/(app)/_console/security-console.tsx" "src/app/(app)/admin/audit/integrity-panel.tsx" "src/app/(app)/admin/audit/admin-integrity-panel.tsx"
git commit -m "feat(console): render audit-stream + integrity times through LocalTime (timezone-aware)"
```

---

### Task 6: Shared TimezoneSelect + global setting (Policy)

**Files:**
- Create: `src/app/(app)/_shell/timezone-select.tsx`
- Modify: `src/app/(app)/admin/policy/platform-settings-form.tsx`
- Modify: `src/app/api/admin/policy/platform/route.ts`

**Interfaces:**
- Produces: `TimezoneSelect({ value, onChange, includeInherit? })`.

- [ ] **Step 1: TimezoneSelect**

Create `src/app/(app)/_shell/timezone-select.tsx`:

```tsx
"use client";

// IANA timezone picker. Uses the browser's supported list; falls back to a small
// set if Intl.supportedValuesOf is unavailable. Empty value = "" (inherit/browser).
const FALLBACK = ["UTC", "Europe/Istanbul", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai"];

function zones(): string[] {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return sv ? sv("timeZone") : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function TimezoneSelect({ value, onChange, inheritLabel }: { value: string; onChange: (v: string) => void; inheritLabel: string }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{inheritLabel}</option>
      {zones().map((z) => (
        <option key={z} value={z}>{z}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Policy global setting**

In `platform-settings-form.tsx`: add `const [tz, setTz] = useState(initial.displayTimezone ?? "");`; add `displayTimezone: tz || null,` to the save body; add a "Display timezone" setting row using `<TimezoneSelect value={tz} onChange={setTz} inheritLabel="Use each viewer's browser timezone" />` (import it), hint: "Dates and times across the console and vendor portal display in this timezone. Users can override it in their own settings. Data is always stored in UTC."

- [ ] **Step 3: Persist**

In `src/app/api/admin/policy/platform/route.ts`, add to the `savePlatformSettings({...})` object:

```ts
    displayTimezone: typeof body.displayTimezone === "string" && body.displayTimezone ? body.displayTimezone : null,
```

- [ ] **Step 4: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/(app)/_shell/timezone-select.tsx" "src/app/(app)/admin/policy/platform-settings-form.tsx" src/app/api/admin/policy/platform/route.ts
git commit -m "feat(policy): global display-timezone setting"
```

---

### Task 7: Per-user timezone preference (Settings)

**Files:**
- Create: `src/app/(app)/settings/preferences/page.tsx`
- Create: `src/app/(app)/settings/preferences/timezone-form.tsx`
- Create: `src/app/api/settings/timezone/route.ts`

- [ ] **Step 1: Save API**

Create `src/app/api/settings/timezone/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { timezone?: string };
  const tz = typeof body.timezone === "string" && body.timezone ? body.timezone : null;
  // Validate against the IANA set (Intl throws on an unknown zone).
  if (tz) {
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { return NextResponse.json({ error: "invalid_timezone" }, { status: 400 }); }
  }
  await db.user.update({ where: { id: user.id }, data: { timezone: tz } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Client form**

Create `src/app/(app)/settings/preferences/timezone-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TimezoneSelect } from "@/app/(app)/_shell/timezone-select";

export function TimezoneForm({ initial }: { initial: string }) {
  const [tz, setTz] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  async function save() {
    setBusy(true); setSaved(false);
    try {
      const res = await fetch("/api/settings/timezone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: tz || undefined }) });
      if (res.ok) { setSaved(true); router.refresh(); }
    } finally { setBusy(false); }
  }
  return (
    <div className="field" style={{ maxWidth: 420 }}>
      <TimezoneSelect value={tz} onChange={setTz} inheritLabel="Use the organization default" />
      <button type="button" className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      {saved && <span className="cell-sub" style={{ marginLeft: 10 }}>Saved.</span>}
    </div>
  );
}
```

- [ ] **Step 3: Page**

Create `src/app/(app)/settings/preferences/page.tsx`:

```tsx
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { TimezoneForm } from "./timezone-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const user = await requireUser();
  const u = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Preferences</h1>
          <p>Your personal display settings. These override the organization defaults for your account only.</p>
        </div>
      </div>
      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Display timezone</h2>
        <p className="cell-sub" style={{ marginBottom: 12 }}>Dates and times you see are shown in this timezone. Leave on the organization default to follow the console-wide setting.</p>
        <TimezoneForm initial={u?.timezone ?? ""} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Build + commit**

Run: `pnpm build`
Expected: success. (Link it from the settings/account nav if there's a settings index — otherwise the page is reachable at `/settings/preferences`; add a nav entry only if a settings menu already lists passkeys/recovery.)

```bash
git add "src/app/(app)/settings/preferences/page.tsx" "src/app/(app)/settings/preferences/timezone-form.tsx" "src/app/api/settings/timezone/route.ts"
git commit -m "feat(settings): per-user display-timezone preference"
```

---

### Task 8: Full verification

**Files:** none.

- [ ] **Step 1: Build green**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 2: Wiring grep**

Run: `grep -rn "resolvedDisplayTimezone" "src/app/(app)/layout.tsx" "src/app/(portal)/layout.tsx" && grep -rn "useTimezone" "src/app/(app)/_shell/local-time.tsx" && grep -rn "displayTimezone" src/lib/settings/platform.ts`
Expected: matches in each.

Run: `grep -rn "toISOString().slice(11" "src/app/(app)/_console/security-console.tsx"`
Expected: no match (hhmm removed).

- [ ] **Step 3: Manual Gate (record for deploy gate)**

Deferred to deploy (`db push` for the two columns):
- Set a global timezone in Policy → console + portal dates render in it (audit stream, tables, live). Set a different per-user timezone in Settings → that user sees their own. Clear both → dates follow the browser timezone (today's behaviour). DB rows unchanged (still UTC).

---

## Self-Review

**Spec coverage:**
- Schema `User.timezone` + `PlatformSettings.displayTimezone` (additive) → Task 1. ✓
- Resolver chain user → global → null → Task 2. ✓
- TimezoneProvider + timezone-aware LocalTime (+ `mode`) → Task 3. ✓
- Provider wired into (app) + (portal) → Task 4. ✓
- Direct date renders (audit-stream UTC + integrity panels) onto LocalTime → Task 5. ✓
- Global TZ selector (Policy) + per-user (Settings) via a shared `TimezoneSelect` → Tasks 6–7. ✓
- Browser-TZ fallback when unset; DB stays UTC; relative helpers + schedule TZ untouched → per design. ✓

**Placeholder scan:** none — concrete code throughout; Task 5/7 note the one JSX-vs-string caveat + the nav-link conditional.

**Type/name consistency:** `resolvedDisplayTimezone(userId)` defined (Task 2) + called in both layouts (Task 4). `useTimezone(): string | null` produced (Task 3) + consumed in LocalTime. `TimezoneSelect({ value, onChange, inheritLabel })` defined (Task 6) + used in Policy (Task 6) + user form (Task 7). `displayTimezone` boolean-less string|null across schema/platform/policy. `timezone` string|null on User across schema/resolver/API.
