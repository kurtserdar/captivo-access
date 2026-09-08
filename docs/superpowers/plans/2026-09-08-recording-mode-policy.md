# Policy-level Recording Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-wide `recordingMode` policy (`off` / `per_resource` / `required`) that governs the per-resource "record sessions" toggle, mirroring the existing `keystrokeLoggingMode` policy. Default `per_resource` preserves today's behavior.

**Architecture:** One nullable `PlatformSettings.recordingMode` column; a pure `effectiveRecordSessions(mode, siteToggle)` helper; a `resolvedRecordingMode()` resolver; the two effective-record resolution points (`by-host`, `gateway/descriptor`) apply the helper; the policy API accepts the field; the policy form and resource form expose it. The global `RECORDING_ENABLED` capability stays master.

**Tech Stack:** Next.js App Router, TypeScript, Prisma (schema via `prisma db push` — no migrations dir; the `saas-migrate` image runs an additive-safe `db push` on deploy), Postgres RLS, vitest. Spec: `docs/superpowers/specs/2026-09-08-recording-mode-policy-design.md`.

## Global Constraints

- English only in the repo (code, comments, console/UI strings). No Claude attribution in commits/PRs.
- `MULTI_TENANT` off ⇒ self-host byte-behavior-identical. Default (`per_resource`, null column) must reproduce today's behavior exactly.
- The global capability `RECORDING_ENABLED` stays master: effective recording is always `recordingEnabled() && effectiveRecordSessions(mode, site.recordSessions)`.
- Policy is applied at per-request resolution, never by mutating a resource's stored `recordSessions`.
- Schema change is additive + nullable; the `saas-migrate` `prisma db push` applies it on deploy. Staging-test against a throwaway Postgres before prod.
- Mirror the existing `keystrokeLoggingMode` members/patterns in `src/lib/settings/platform.ts` and `src/app/api/admin/policy/platform/route.ts` verbatim in shape.
- Deploy + release-note steps are separate standing gates requiring explicit user approval.

## Test DB note

Integration tests are DB-gated (skip without `TEST_DATABASE_URL`). Run them against a throwaway Postgres mirroring CI's `rls-integration` job: `docker run` postgres:16-alpine on `127.0.0.1:15432`, `DATABASE_URL=… prisma db push`, then `psql -f prisma/rls/pre-push.sql` and `psql -f prisma/rls/bootstrap.sql` (`-v app_password=rls_test_pw`). Then `TEST_DATABASE_URL=postgresql://access:test@127.0.0.1:15432/captivo_test npx vitest run <file>` (one file per process). Never `db push` against a live DB. Wire every new DB-gated test into `.github/workflows/ci.yml`'s `rls-integration` job (mirroring existing entries; quote bracketed paths).

---

### Task 1: Recording-mode primitives (schema, helper, resolver, plumbing)

**Files:**
- Modify: `prisma/schema.prisma` (add `recordingMode String?` to `PlatformSettings`)
- Create: `src/lib/recording/mode.ts`, `src/lib/recording/mode.test.ts`
- Modify: `src/lib/settings/platform.ts` (type + EMPTY + mapping + `RECORDING_MODES` + `resolvedRecordingMode`)
- Create: `src/lib/settings/recording-mode.integration.test.ts`
- Modify: `.github/workflows/ci.yml` (wire the new integration test)

**Interfaces:**
- Produces (consumed by Tasks 2-3):
  - `effectiveRecordSessions(mode: string, siteToggle: boolean): boolean` (`src/lib/recording/mode.ts`)
  - `RECORDING_MODES: readonly ["off","per_resource","required"]` and `resolvedRecordingMode(): Promise<string>` (`src/lib/settings/platform.ts`)
  - `PlatformSettings.recordingMode: string | null` (settings type)

- [ ] **Step 1: Write the failing unit test for the pure helper**

```ts
// src/lib/recording/mode.test.ts
import { describe, it, expect } from "vitest";
import { effectiveRecordSessions } from "./mode";

describe("effectiveRecordSessions", () => {
  it("off → never records", () => {
    expect(effectiveRecordSessions("off", true)).toBe(false);
    expect(effectiveRecordSessions("off", false)).toBe(false);
  });
  it("required → always records", () => {
    expect(effectiveRecordSessions("required", false)).toBe(true);
    expect(effectiveRecordSessions("required", true)).toBe(true);
  });
  it("per_resource → follows the resource toggle", () => {
    expect(effectiveRecordSessions("per_resource", true)).toBe(true);
    expect(effectiveRecordSessions("per_resource", false)).toBe(false);
  });
  it("unknown mode → safe default (per-resource behavior)", () => {
    expect(effectiveRecordSessions("bogus", true)).toBe(true);
    expect(effectiveRecordSessions("bogus", false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/recording/mode.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/recording/mode.ts
// Applies the tenant recording policy to a resource's own toggle. The global
// RECORDING_ENABLED capability is applied separately by the caller.
export function effectiveRecordSessions(mode: string, siteToggle: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "required") return true;
  return siteToggle; // "per_resource" and any unknown value → resource decides
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/recording/mode.test.ts` — Expected: PASS.

- [ ] **Step 5: Add the schema column**

In `prisma/schema.prisma`, `model PlatformSettings`, next to `clipboardDefault`/`keystrokeLoggingMode`, add:

```prisma
  recordingMode String? // null = env/default → "per_resource"; one of off|per_resource|required
```

Run: `npx prisma generate` (or `pnpm db:generate`) — Expected: client regenerates cleanly.

- [ ] **Step 6: Plumb the field + resolver in `src/lib/settings/platform.ts`**

Mirror `keystrokeLoggingMode` exactly:
- Add `recordingMode: string | null;` to the `PlatformSettings` type.
- Add `recordingMode: null,` to `EMPTY`.
- Add `recordingMode: c?.recordingMode ?? null,` to the `getPlatformSettings()` mapping.
- Add the modes constant + resolver:

```ts
export const RECORDING_MODES = ["off", "per_resource", "required"] as const;
export async function resolvedRecordingMode(): Promise<string> {
  const s = await getPlatformSettings();
  if (s.recordingMode && (RECORDING_MODES as readonly string[]).includes(s.recordingMode)) return s.recordingMode;
  const v = process.env.RECORDING_MODE?.trim().toLowerCase();
  if (v && (RECORDING_MODES as readonly string[]).includes(v)) return v;
  return "per_resource";
}
```

- [ ] **Step 7: Write the failing resolver integration test**

```ts
// src/lib/settings/recording-mode.integration.test.ts — DB-gated, mirror an existing
// platform-settings integration test's setup (MULTI_TENANT on, RLS bootstrap, a tenant scope).
// Assert, under a tenant scope:
//  - unset → resolvedRecordingMode() === "per_resource"
//  - after upserting PlatformSettings.recordingMode = "required" → "required"
//  - invalid stored value → falls back to "per_resource"
```
Write the concrete test mirroring the harness in `src/lib/tenant/platform.integration.test.ts` (or the nearest platform-settings integration test). Seed via `db.platformSettings.upsert` inside `withTenant(tenantId, …)`.

- [ ] **Step 8: Run it (fails until env/DB set up), then implement passes**

Run against the throwaway DB (see Test DB note): `TEST_DATABASE_URL=… npx vitest run src/lib/settings/recording-mode.integration.test.ts` — Expected: PASS (Steps 5-6 already implement it; this test pins behavior).

- [ ] **Step 9: Wire the integration test into CI + typecheck/build**

Add to `.github/workflows/ci.yml` `rls-integration`:
`- run: TEST_DATABASE_URL=$DB_URL npx vitest run src/lib/settings/recording-mode.integration.test.ts`
Run: `npm run build` (or `pnpm typecheck`) — Expected: green.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma src/lib/recording/mode.ts src/lib/recording/mode.test.ts \
        src/lib/settings/platform.ts src/lib/settings/recording-mode.integration.test.ts \
        .github/workflows/ci.yml \
        docs/superpowers/specs/2026-09-08-recording-mode-policy-design.md \
        docs/superpowers/plans/2026-09-08-recording-mode-policy.md
git commit -m "feat(recording): recordingMode policy primitives — schema, resolver, effective helper"
```

---

### Task 2: Enforce the policy + accept it in the policy API

**Files:**
- Modify: `src/app/api/internal/site/by-host/route.ts`
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`
- Modify: `src/app/api/admin/policy/platform/route.ts`
- Create: `src/app/api/internal/site/by-host/route.recording-mode.integration.test.ts`
- Modify: `.github/workflows/ci.yml` (wire the new integration test)

**Interfaces:**
- Consumes: `effectiveRecordSessions`, `resolvedRecordingMode` from Task 1.

- [ ] **Step 1: Write the failing enforcement integration test**

DB-gated, multi-tenant harness. For tenant A with `RECORDING_ENABLED=on`, a TRANSPARENT site whose `recordSessions=false`, exercise `by-host` resolution (invoke the route handler / the resolver path it uses) under each policy:
```
// recordingMode "required" → effective record === true  (forced despite toggle false)
// recordingMode "off"      → effective record === false (even if a second site's toggle is true)
// recordingMode "per_resource" → effective record === site.recordSessions
// with RECORDING_ENABLED off → effective record === false for every mode
```
Set `RECORDING_ENABLED`/`RECORDING_MODE` via env and/or seed `PlatformSettings.recordingMode`. Mirror the harness of an existing internal-route integration test. Run: Expected FAIL (routes not yet using the helper).

- [ ] **Step 2: Apply the helper in `by-host`**

In `src/app/api/internal/site/by-host/route.ts`, replace `const recordSessions = site.recordSessions && recordingEnabled();` with:
```ts
const recordSessions = recordingEnabled() && effectiveRecordSessions(await resolvedRecordingMode(), site.recordSessions);
```
Add the imports (`effectiveRecordSessions` from `@/lib/recording/mode`, `resolvedRecordingMode` from `@/lib/settings/platform`).

- [ ] **Step 3: Apply the helper in `gateway/descriptor`**

In `src/app/api/internal/gateway/descriptor/route.ts`, compute once near the top of the handler:
```ts
const record = recordingEnabled() && effectiveRecordSessions(await resolvedRecordingMode(), site.recordSessions);
```
and use that `record` at both existing sites (the two `record: recordingEnabled() && site.recordSessions` occurrences). The route already awaits `resolvedKeystrokeLoggingMode()`, so an added await is consistent.

- [ ] **Step 4: Run the enforcement test to verify it passes**

Run against the throwaway DB: `TEST_DATABASE_URL=… npx vitest run src/app/api/internal/site/by-host/route.recording-mode.integration.test.ts` — Expected: PASS.

- [ ] **Step 5: Accept + validate `recordingMode` in the policy API**

In `src/app/api/admin/policy/platform/route.ts`, in the settings object written to `db.platformSettings.upsert`, add (mirroring the `keystrokeLoggingMode` line):
```ts
recordingMode: ["off", "per_resource", "required"].includes(body.recordingMode)
  ? (body.recordingMode as string) : null,
```

- [ ] **Step 6: Extend the enforcement test with the API round-trip + isolation, run, wire CI**

Add to the same test: POST the policy handler with `recordingMode:"required"` under tenant A → read back `resolvedRecordingMode()` === "required" under A, and === "per_resource" under a second tenant B (cross-tenant isolation). Run it (PASS). Add its `- run:` line to `.github/workflows/ci.yml` `rls-integration`.

- [ ] **Step 7: Typecheck/build + commit**

Run: `npm run build` — Expected: green.
```bash
git add src/app/api/internal/site/by-host/route.ts src/app/api/internal/gateway/descriptor/route.ts \
        src/app/api/admin/policy/platform/route.ts \
        src/app/api/internal/site/by-host/route.recording-mode.integration.test.ts .github/workflows/ci.yml
git commit -m "feat(recording): apply recordingMode at the resolution points + accept it in the policy API"
```

---

### Task 3: UI — policy select + resource-form lock

**Files:**
- Modify: the platform-settings form component rendered by `/admin/policy` (`PlatformSettingsForm`)
- Modify: `src/app/(app)/admin/sites/site-form.tsx`
- Modify: the pages that render `site-form` (new + edit) to pass the current `recordingMode`
- Create: `src/lib/recording/mode.ui.test.ts` (pure lock-decision helper test)

**Interfaces:**
- Consumes: `RECORDING_MODES`, `resolvedRecordingMode` (Task 1); the `PlatformSettings` type with `recordingMode`.

- [ ] **Step 1: Write the failing unit test for the lock-decision helper**

```ts
// src/lib/recording/mode.ui.test.ts
import { describe, it, expect } from "vitest";
import { recordToggleLock } from "./mode";

describe("recordToggleLock", () => {
  it("per_resource → not locked, toggle free", () => {
    expect(recordToggleLock("per_resource")).toEqual({ locked: false, forcedValue: null });
  });
  it("required → locked on", () => {
    expect(recordToggleLock("required")).toEqual({ locked: true, forcedValue: true });
  });
  it("off → locked off", () => {
    expect(recordToggleLock("off")).toEqual({ locked: true, forcedValue: false });
  });
});
```

- [ ] **Step 2: Run to verify fail, then add the helper to `src/lib/recording/mode.ts`**

```ts
export function recordToggleLock(mode: string): { locked: boolean; forcedValue: boolean | null } {
  if (mode === "required") return { locked: true, forcedValue: true };
  if (mode === "off") return { locked: true, forcedValue: false };
  return { locked: false, forcedValue: null };
}
```
Run: `npx vitest run src/lib/recording/mode.ui.test.ts` — Expected: PASS.

- [ ] **Step 3: Add the `recordingMode` select to the policy form**

In `PlatformSettingsForm`, add a labeled select (Off / Per resource / Required) bound to `recordingMode`, placed with the recording-consent + keystroke-logging controls, each option with one line of help text (note under `required`: resources cannot opt out). Include the field in the form's submitted body so the Task 2 API persists it. Mirror the existing `keystrokeLoggingMode` control's markup.

- [ ] **Step 4: Lock the resource-form toggle per policy**

In `src/app/(app)/admin/sites/site-form.tsx`, accept a `recordingMode: string` prop. Use `recordToggleLock(recordingMode)`: when `locked`, render the "record sessions" checkbox `disabled`, its checked state = `forcedValue`, with a short note "Managed by policy: <mode>". When not locked, behave exactly as today. The stored value the form submits for a locked toggle is irrelevant to runtime (policy overrides at resolution), but keep the submitted value equal to the resource's existing stored preference so it is preserved when policy later returns to `per_resource`.

- [ ] **Step 5: Pass `recordingMode` from the pages that render the form**

In the new-resource and edit-resource pages that render `site-form`, resolve the current mode server-side (`await resolvedRecordingMode()`) and pass it as the prop. (These pages are already wrapped in `withRequestTenant`, so `resolvedRecordingMode()` reads the correct tenant.)

- [ ] **Step 6: Typecheck/build + full suite**

Run: `npx vitest run` (unit suite) — Expected: green (includes the two new pure-helper tests).
Run: `npm run build` — Expected: green.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/admin" src/lib/recording/mode.ts src/lib/recording/mode.ui.test.ts
git commit -m "feat(recording): recordingMode policy control + resource-form lock"
```

---

## Self-Review

**Spec coverage:** §1 schema → Task 1 Step 5. §2 settings plumbing/resolver → Task 1 Steps 6-8. §3 effective helper → Task 1 Steps 1-4. §4 application points → Task 2 Steps 2-4. §5 policy API → Task 2 Step 5. §6 UI (policy form + resource-form lock) → Task 3. §7 consent/keystroke boundary → no code change (recordingMode governs recording only; keystroke path untouched — verified by not modifying keystroke logic). Testing § → Task 1 (helper unit + resolver integration), Task 2 (enforcement + API + isolation integration), Task 3 (lock-helper unit + build). Self-host regression → default `per_resource`, full suite in Task 3 Step 6.

**Placeholder scan:** none — every code step has concrete code or an exact mirror reference (`keystrokeLoggingMode`) plus the file/line area to change.

**Type consistency:** `effectiveRecordSessions`, `recordToggleLock`, `resolvedRecordingMode`, `RECORDING_MODES`, `PlatformSettings.recordingMode` are defined in Task 1/3 and used consistently in Tasks 2-3.

**Note for the implementer:** the exact `PlatformSettingsForm` component path and the new/edit resource page paths are discoverable from `/admin/policy/page.tsx` (imports `PlatformSettingsForm`) and `src/app/(app)/admin/sites/` — confirm before editing. Mirror the nearest existing platform-settings integration test for harness setup rather than inventing one.
