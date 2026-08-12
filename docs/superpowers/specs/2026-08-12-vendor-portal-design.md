# Vendor Portal — "My access" Home — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** 2b of the dashboard redesign. A dedicated, light-themed home surface for connect-only (vendor) users. First slice: the **My access home screen only** (design `#2b` in `/home/jhum/Dashboard Alternatifleri.dc.html`, README bundled alongside).

## Problem

Connect-only users (roles with no console capability — `VENDOR`, `STAFF`) currently land on a bare card inside the admin shell (`(app)/page.tsx` non-console branch) and their real content sits at `/access`, also rendered inside the admin sidebar chrome. There is no dedicated vendor surface; a vendor sees admin framing that isn't theirs.

This slice gives connect-only users their own light-themed portal whose home is the "My access" screen: granted resources with time-remaining bars, a security-status summary, upcoming windows, recent sessions, and a request-access CTA.

## Scope

- **In:** a new `(portal)` route group with its own light shell; the `/access` page relocated into it and redesigned to the `#2b` layout; landing redirect for connect-only users; real data wiring; pure helpers with unit tests.
- **Out:** the "Requests" and "History" nav pages (portal nav shows **only** "My access" this slice — no dead links); the `#2a` admin console; audit trail; image/rich content. No schema change.
- **Terminology:** "vendor" (role stays `VENDOR`; industry-standard term).
- **English-only.**

## Roles / gating

- Capability model already exists: `isConsoleUser(role)` is true for `ADMIN`/`OPERATOR`/`AUDITOR`, false for `STAFF`/`VENDOR` (`src/lib/auth/roles.ts`).
- The portal is the home for **connect-only** users. `(app)/page.tsx`'s non-console branch (currently a card) becomes `redirect("/access")`.
- `(portal)` layout calls `requireUser()` only — it does not hard-block console users. A console user who navigates to `/access` sees the portal (their own per-principal access); their default landing stays the admin dashboard. All data is scoped to the authenticated principal, exactly as today.

## Architecture / routing

- **New route group `src/app/(portal)/`** with its own `layout.tsx` — light theme, no admin sidebar. Because Next.js route groups don't change the URL, `/access` moves from `(app)` to `(portal)`; there is exactly one `/access` route (the portal).
- **Move** (git mv, preserving history where possible) from `src/app/(app)/access/` to `src/app/(portal)/access/`:
  - `request-access-button.tsx`, `request-access-form.tsx`, `withdraw-request-button.tsx` — reused as-is.
  - `access-view.tsx` is **retired** (replaced by the portal home presentation below); delete it after the move.
- **Modify** `src/app/(app)/page.tsx`: replace the non-console branch body (the "You have N active grants… My access" card) with `redirect("/access")`. Keep the console/admin branches unchanged.

## Shell — `(portal)/layout.tsx`

Light shell matching `#2b`:
- Top 3px brand line: `linear-gradient(90deg,#0f766e,#2dd4bf 40%,#0f766e)`.
- Top nav (64px, border-bottom `#eceae6`): logo mark (28px `#0f766e` square, mono "C") + wordmark "Captivo ACCESS"; nav with a **single** item "My access" (active `#1c1917`/600); right: user avatar (initials, `#e7e5e4`/`#57534e`) + a logout affordance (reuse existing `logout-button.tsx`).
- Body background `#fcfcfb`; font family Public Sans (see Fonts). `requireUser()` at the top.

## Home screen — `(portal)/access/page.tsx` (server) + `portal-home.tsx` (presentation)

The server component gathers data and passes plain serializable props to `PortalHome` (client where interactivity is needed; otherwise server). Reuses the existing grant pipeline.

### Data (all real, scoped to `user.id`)

1. **Access cards** ← `listUserGrants(user.id)` → `classifyGrant(g, now)` → `AccessRow[]` (same mapping as today's `/access`: `active | upcoming | off_hours | pending | denied`, plus `siteId/siteName/hostname/accessMode/hasLogo/startsAtISO/endsAtISO/schedule/recorded`). Cards render the rows whose status is `active` (and `off_hours`/`pending` shown with their state); `denied` shown with reason.
2. **Upcoming** ← the same rows with status `upcoming` (grants whose window opens in the future). No extra query.
3. **Recent sessions** ← `src/lib/recording/query.ts` (already filters by `userId`): most recent 3 `SessionRecording` rows for the user → `{ siteName/host, protocol, startedAt, durationMs = lastEventAt - startedAt }`.
4. **Security status** ← derived by a pure helper (below) from: passkey count (`db.passkey.count({ where: { userId } })` > 0), whether any of the user's granted resources are recorded (`recordingEnabled() && rows.some(r => r.recorded)`), and the static VPN-less line.

### Layout (`#2b`, light)

- **Header row**: greeting "Welcome back, {firstName}" (30px/800 `#1c1917`; no time-of-day logic — avoids needing the user's timezone), subline "{activeCount} active grants · all sessions on this workspace are recorded" (drop the recorded clause when nothing is recorded); right: **"Request access"** CTA = existing `RequestAccessButton` (teal `#0f766e` fill).
- **Main grid `1fr 320px`, gap 24:**
  - **Left — access cards** (stacked, gap 16): white card, border `#eceae6` (hover `#99f6e4`), radius 16. Row: 44px tinted icon square (logo if `hasLogo` else initials with a type-derived tint), name 17px/700 + type chip (accessMode/protocol), host mono 13px `#a8a29e`, **Open ↗** button (fill `#1c1917`, `target="_blank" rel="noopener noreferrer"`; rendered as a disabled non-link when status ≠ `active`). The launch target is the logic currently inline in `access-view.tsx` — extract it to a pure helper `src/lib/portal/launch-href.ts`: `launchHref(accessMode: string, siteId: string, hostname: string): string` returning `accessMode === "GATEWAY" ? \`/gateway/${siteId}/session\` : \`https://${hostname}\``. Below: window label vs remaining (color: amber `#b45309` when <24h, teal `#0f766e` otherwise, gray for schedule-bound) + 6px progress bar (track `#f5f5f4`, fill matching tone). Remaining text + percent from the time-remaining helper.
  - **Right rail** (3 cards): **Security status** (dot + line per derived status), **Upcoming** (2px left border `#99f6e4`, name + when), **Recent sessions** (name vs duration rows; "Full history →" is **omitted** this slice since History isn't built — replace with a plain muted line when empty).
- **Footer strip**: `#f5f5f4` rounded, helper text "Need something that isn't listed? Your request goes to the resource owner for approval." (the "Browse catalog →" link is omitted — no catalog page this slice).

### Empty states

- No grants: friendly empty card "You don't have any access yet." + the Request access CTA.
- No upcoming: muted "Nothing scheduled." No recent sessions: muted "No sessions yet."

## Pure helpers (unit-tested, `src/lib/portal/`)

1. **`time-remaining.ts`** — `remaining(startISO: string|null, endISO: string|null, schedule: string|null, now: Date): { label: string; text: string; pct: number; tone: "urgent"|"ok"|"schedule" }`.
   - `endISO` set: `text` = humanized time left ("14h 16m left"), `pct` = elapsed/(total) window as 0–100 (inverse fill handled in CSS width), `tone` = `urgent` if <24h else `ok`.
   - schedule-bound (no fixed end): `tone = "schedule"`, `text` = e.g. "business hours", `pct` = 0.
   - both null (permanent): `tone = "ok"`, `text = "Permanent"`, `pct = 0`.
2. **`security-status.ts`** — `securityStatus(input: { hasPasskey: boolean; anyRecorded: boolean }): { label: string; tone: "good"|"info"|"muted" }[]`.
   - `hasPasskey` → "Passkey enabled" (good/teal) else "Passkey not set up" (muted).
   - `anyRecorded` → "Sessions recorded & audited" (info/red).
   - always → "No VPN required" (muted).

3. **`launch-href.ts`** — `launchHref(accessMode, siteId, hostname)` as above (extracted from `access-view.tsx`).

These are the only logic worth testing; presentation and data-fetching are verified manually (per repo convention).

## Fonts / theme

- Add **Public Sans** via `next/font/google` in `src/app/layout.tsx` (exposed as a CSS variable, e.g. `--font-public-sans`). IBM Plex Sans/Mono already present.
- The `(portal)` layout applies the Public Sans variable to its subtree; mono data uses the existing IBM Plex Mono.
- Portal styles: a new `/* Vendor portal */` section in `src/app/globals.css` using the README's light tokens (page `#fcfcfb`, card `#fff`, border `#eceae6`, text `#1c1917`/`#57534e`/`#78716c`/`#a8a29e`, brand teal scale, status red/amber). Class-prefixed `vp-` to avoid collisions.

## Testing

- **Unit** (`vitest`, colocated `*.test.ts`): `time-remaining.test.ts` (urgent <24h, ok ≥24h, schedule-bound, permanent, percent math), `security-status.test.ts` (four combinations of passkey × recorded), and `launch-href.test.ts` (GATEWAY vs web).
- **Build gate:** `pnpm build`.
- **Manual** (after deploy): a `VENDOR` user lands on `/access` (portal shell, light, no admin sidebar); cards show correct remaining/percent and open active resources; upcoming/recent/security reflect real state; empty states; a console user visiting `/access` also sees the portal; the admin dashboard is unchanged.

## Out of scope (future slices)

- Portal "Requests" and "History" pages; `#2a` admin console; file-transfer audit trail; resource catalog/browse.
