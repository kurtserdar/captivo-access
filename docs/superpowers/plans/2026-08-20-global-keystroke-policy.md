# Global Keystroke Logging Policy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-wide keystroke-logging policy (`off` / `per_resource` / `required`) at `/admin/policy` that governs the per-Resource keystroke timeline shipped in v0.88.0.

**Architecture:** A new nullable `keystrokeLoggingMode` on the `PlatformSettings` singleton (DB→default, no env), resolved through the existing settings layer. A pure `effectiveKeystrokeLogging()` helper decides the per-session boolean; the gateway descriptor route calls it. UI: a selector on the platform policy form, and the per-Resource checkbox reflects the global mode.

**Tech Stack:** Next.js 16 (App Router, nodejs runtime), Prisma (`db push`), React client components, Vitest.

## Global Constraints

- **English only** — all code, comments, UI strings, commit messages, release notes. (captivo-access is a public OSS repo.)
- **No Claude signature** in commits.
- `Site.keystrokeLogging` (boolean) is **unchanged** — per-Resource intent is preserved across policy changes.
- New setting has **no env-var fallback** (UI-only, like `maxGrantDays`).
- Default behavior unchanged: `keystrokeLoggingMode` null → `per_resource`.
- Keystroke logging is an **adjunct to recording** — every mode (including `required`) is gated on `recordingEnabled() && site.recordSessions`. Keystroke policy never forces recording on.
- Mode values are exactly the strings `"off"`, `"per_resource"`, `"required"`.
- Schema change is **additive** (nullable column) — `db push` is non-destructive; bump the migrate image to the release tag alongside manager (per prior migrate-skew lesson).
- Do NOT deploy or write release notes without explicit user approval (separate gate).

---

### Task 1: Settings field + resolver + persistence

**Files:**
- Modify: `prisma/schema.prisma` (model `PlatformSettings`)
- Modify: `src/lib/settings/platform.ts`
- Modify: `src/app/api/admin/policy/platform/route.ts`

**Interfaces:**
- Produces: `type KeystrokeMode = "off" | "per_resource" | "required"` and `resolvedKeystrokeLoggingMode(): Promise<KeystrokeMode>` (exported from `@/lib/settings/platform`), consumed by Tasks 2–4. Adds `keystrokeLoggingMode: string | null` to the exported `PlatformSettings` interface, consumed by Task 4.

- [ ] **Step 1: Add the schema column.** In `prisma/schema.prisma`, in `model PlatformSettings`, add:

```prisma
  keystrokeLoggingMode String?  // "off" | "per_resource" | "required"; null → per_resource
```

- [ ] **Step 2: Push schema to the local dev DB and regenerate client.**

Run: `DATABASE_URL="postgresql://access:${PW}@127.0.0.1:5434/captivo_access" npx prisma db push` (use the prod-DB access described in project memory; for a pure typecheck `npx prisma generate` suffices). Expected: `keystrokeLoggingMode` column added, client regenerated. (Additive/nullable — no data-loss prompt.)

- [ ] **Step 3: Extend the settings layer.** In `src/lib/settings/platform.ts`:
  - Add `keystrokeLoggingMode: string | null;` to the `PlatformSettings` interface.
  - Add `keystrokeLoggingMode: null,` to the `EMPTY` constant.
  - Add `keystrokeLoggingMode: c?.keystrokeLoggingMode ?? null,` to the mapping in `getPlatformSettings`.
  - Add the type + resolver near `resolvedDefaultConnectorLogLevel`:

```ts
export type KeystrokeMode = "off" | "per_resource" | "required";
const KEYSTROKE_MODES: KeystrokeMode[] = ["off", "per_resource", "required"];

// Tenant-wide keystroke-logging mode: DB value if valid, else per_resource.
// No env fallback (UI-only control).
export async function resolvedKeystrokeLoggingMode(): Promise<KeystrokeMode> {
  const s = await getPlatformSettings();
  const v = s.keystrokeLoggingMode;
  return v && (KEYSTROKE_MODES as string[]).includes(v) ? (v as KeystrokeMode) : "per_resource";
}
```

(`savePlatformSettings` needs no change — it upserts the whole `input`; but every caller of `savePlatformSettings` must now supply the field. The only caller is the policy route, updated next.)

- [ ] **Step 4: Persist from the policy route.** In `src/app/api/admin/policy/platform/route.ts`, inside the `savePlatformSettings({ ... })` object literal, add:

```ts
    keystrokeLoggingMode: ["off", "per_resource", "required"].includes(body.keystrokeLoggingMode)
      ? (body.keystrokeLoggingMode as string)
      : "per_resource",
```

- [ ] **Step 5: Typecheck.**

Run: `pnpm build`
Expected: PASS (the new interface field is satisfied by the route's literal; no other `savePlatformSettings` callers).

- [ ] **Step 6: Commit.**

```bash
git add prisma/schema.prisma src/lib/settings/platform.ts src/app/api/admin/policy/platform/route.ts
git commit -m "feat(policy): add keystrokeLoggingMode setting + resolver"
```

---

### Task 2: Pure `effectiveKeystrokeLogging` helper (TDD)

**Files:**
- Create: `src/lib/keystroke/policy.ts`
- Test: `src/lib/keystroke/policy.test.ts`

**Interfaces:**
- Consumes: `KeystrokeMode` from `@/lib/settings/platform` (Task 1).
- Produces: `effectiveKeystrokeLogging({ mode, recordingEnabled, recordSessions, siteFlag }): boolean`, consumed by Task 3.

- [ ] **Step 1: Write the failing test.** Create `src/lib/keystroke/policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveKeystrokeLogging } from "./policy";

const base = { recordingEnabled: true, recordSessions: true, siteFlag: false };

describe("effectiveKeystrokeLogging", () => {
  it("is false whenever recording is globally disabled", () => {
    for (const mode of ["off", "per_resource", "required"] as const) {
      expect(effectiveKeystrokeLogging({ ...base, recordingEnabled: false, siteFlag: true, mode })).toBe(false);
    }
  });

  it("is false whenever the site does not record sessions", () => {
    for (const mode of ["off", "per_resource", "required"] as const) {
      expect(effectiveKeystrokeLogging({ ...base, recordSessions: false, siteFlag: true, mode })).toBe(false);
    }
  });

  it("off → false even when the site flag is on", () => {
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: true, mode: "off" })).toBe(false);
  });

  it("required → true regardless of the site flag", () => {
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: false, mode: "required" })).toBe(true);
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: true, mode: "required" })).toBe(true);
  });

  it("per_resource → mirrors the site flag", () => {
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: true, mode: "per_resource" })).toBe(true);
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: false, mode: "per_resource" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test -- src/lib/keystroke/policy.test.ts`
Expected: FAIL (module `./policy` not found).

- [ ] **Step 3: Implement the helper.** Create `src/lib/keystroke/policy.ts`:

```ts
import type { KeystrokeMode } from "@/lib/settings/platform";

// Effective per-session keystroke-logging decision. Keystroke logging is an
// adjunct to recording (the timeline seeks the recording), so every mode is
// gated on recording being active for the session — including "required".
export function effectiveKeystrokeLogging(input: {
  mode: KeystrokeMode;
  recordingEnabled: boolean;
  recordSessions: boolean;
  siteFlag: boolean;
}): boolean {
  const base = input.recordingEnabled && input.recordSessions;
  if (!base) return false;
  switch (input.mode) {
    case "off":
      return false;
    case "required":
      return true;
    case "per_resource":
      return input.siteFlag;
    default:
      return input.siteFlag;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm test -- src/lib/keystroke/policy.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/keystroke/policy.ts src/lib/keystroke/policy.test.ts
git commit -m "feat(policy): pure effectiveKeystrokeLogging helper + tests"
```

---

### Task 3: Wire the descriptor route to the policy

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts:77`

**Interfaces:**
- Consumes: `resolvedKeystrokeLoggingMode` (Task 1), `effectiveKeystrokeLogging` (Task 2).

- [ ] **Step 1: Add imports.** In `descriptor/route.ts`, add to the existing settings import (line 5/8 area) `resolvedKeystrokeLoggingMode`, and a new import for the helper:

```ts
import { resolvedWatermarkDefault, resolvedGuacParamDefaults, resolvedKeystrokeLoggingMode } from "@/lib/settings/platform";
import { effectiveKeystrokeLogging } from "@/lib/keystroke/policy";
```

(Merge the two existing `@/lib/settings/platform` imports into one line while here.)

- [ ] **Step 2: Replace the keystroke computation.** In the GATEWAY response object (currently line 77), replace:

```ts
    keystrokeLogging: recordingEnabled() && site.recordSessions && site.keystrokeLogging,
```

with:

```ts
    keystrokeLogging: effectiveKeystrokeLogging({
      mode: await resolvedKeystrokeLoggingMode(),
      recordingEnabled: recordingEnabled(),
      recordSessions: site.recordSessions,
      siteFlag: site.keystrokeLogging,
    }),
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/internal/gateway/descriptor/route.ts
git commit -m "feat(policy): resolve keystroke logging through the global mode in the descriptor"
```

---

### Task 4: Policy form control

**Files:**
- Modify: `src/app/(app)/admin/policy/platform-settings-form.tsx`

**Interfaces:**
- Consumes: `initial.keystrokeLoggingMode` (Task 1 interface field). The page loader already passes `initial={await getPlatformSettings()}` — no page change needed.

- [ ] **Step 1: Add state.** Near the other `useState` hooks (around line 24, next to `connLog`), add:

```ts
  const [ksMode, setKsMode] = useState(initial.keystrokeLoggingMode ?? "per_resource");
```

- [ ] **Step 2: Submit the value.** In the submit body object (near `defaultConnectorLogLevel: connLog,`), add:

```ts
        keystrokeLoggingMode: ksMode,
```

- [ ] **Step 3: Render the control.** In the recording/session area of the form (near the watermark/consent controls, mirroring the `connLog` `<select>` at line ~142), add a labelled selector:

```tsx
            <label className="setting-row">
              <div>
                <div className="setting-label">Keystroke logging</div>
                <div className="setting-sub">Applies to sessions where recording is enabled.</div>
              </div>
              <select className="select" value={ksMode} onChange={(e) => setKsMode(e.target.value)} aria-label="Keystroke logging mode">
                <option value="off">Off — disabled for all resources</option>
                <option value="per_resource">Per resource — each resource decides</option>
                <option value="required">Required — forced on for every recorded session</option>
              </select>
            </label>
```

(Match the exact markup/classes of the surrounding `setting-row` controls in this file; the snippet above is the intended content, adapt class names to the file's actual pattern.)

- [ ] **Step 4: Typecheck + manual check.**

Run: `pnpm build`
Expected: PASS. (Manual, post-deploy: `/admin/policy` shows the selector; saving persists; reload reflects the saved value.)

- [ ] **Step 5: Commit.**

```bash
git add src/app/(app)/admin/policy/platform-settings-form.tsx
git commit -m "feat(policy): keystroke logging mode selector on the policy form"
```

---

### Task 5: Per-Resource checkbox reflects the global mode

**Files:**
- Modify: `src/app/(app)/admin/sites/site-form.tsx`
- Modify: `src/app/(app)/admin/sites/[id]/edit/page.tsx`
- Modify: `src/app/(app)/admin/sites/add-site-button.tsx`
- Modify: `src/app/(app)/admin/sites/page.tsx`

**Interfaces:**
- Consumes: `resolvedKeystrokeLoggingMode` (Task 1), `KeystrokeMode` type.
- `SiteForm` gains a `keystrokeMode?: KeystrokeMode` prop (default `"per_resource"`). `AddSiteButton` gains and forwards the same prop. Both server pages resolve and pass it.

- [ ] **Step 1: Add the prop to `SiteForm`.** In `site-form.tsx`, add `keystrokeMode` to the props type (default `"per_resource"`) and import `KeystrokeMode`:

```ts
import type { KeystrokeMode } from "@/lib/settings/platform";
// ...in props: keystrokeMode = "per_resource" as KeystrokeMode
// signature: keystrokeMode?: KeystrokeMode;
```

- [ ] **Step 2: Gate the checkbox block.** The keystroke block (currently line ~420, shown when `recordingEnabled && accessMode === "GATEWAY" && recordSessions`) becomes mode-aware:
  - `keystrokeMode === "off"` → do not render the checkbox; render a muted note: `Keystroke logging is disabled in Policy.`
  - `keystrokeMode === "required"` → render the checkbox `checked` and `disabled`, with a note: `Required by Policy — on for all recorded sessions.`
  - `keystrokeMode === "per_resource"` → current editable checkbox.

Keep submitting `keystrokeLogging` state as today (its stored value is untouched under off/required). Example shape:

```tsx
      {recordingEnabled && accessMode === "GATEWAY" && recordSessions && keystrokeMode !== "off" && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={keystrokeMode === "required" ? true : keystrokeLogging}
            disabled={keystrokeMode === "required"}
            onChange={(e) => setKeystrokeLogging(e.target.checked)}
          />
          Keystroke timeline
          {keystrokeMode === "required" && <span className="hint"> — required by Policy</span>}
        </label>
      )}
      {recordingEnabled && accessMode === "GATEWAY" && recordSessions && keystrokeMode === "off" && (
        <p className="setting-sub">Keystroke logging is disabled in Policy.</p>
      )}
```

(Adapt class names to the file's actual keystroke block markup.)

- [ ] **Step 3: Pass the prop from the edit page.** In `[id]/edit/page.tsx`, import `resolvedKeystrokeLoggingMode` and add `keystrokeMode={await resolvedKeystrokeLoggingMode()}` to the `<SiteForm ... />`.

- [ ] **Step 4: Pass the prop through the create flow.** In `page.tsx` (sites list), resolve the mode and pass it to `<AddSiteButton keystrokeMode={...} />`; in `add-site-button.tsx`, add `keystrokeMode: KeystrokeMode` to its props and forward it to `<SiteForm keystrokeMode={keystrokeMode} ... />`.

- [ ] **Step 5: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Full test suite.**

Run: `pnpm test`
Expected: PASS (452 prior + the new policy helper tests).

- [ ] **Step 7: Commit.**

```bash
git add src/app/(app)/admin/sites/site-form.tsx "src/app/(app)/admin/sites/[id]/edit/page.tsx" src/app/(app)/admin/sites/add-site-button.tsx src/app/(app)/admin/sites/page.tsx
git commit -m "feat(policy): per-resource keystroke checkbox reflects the global mode"
```

---

## Deploy (SEPARATE — needs explicit user approval, do not run as part of implementation)

- `db push` the additive column to prod DB.
- Tag `v0.89.0`; CI publishes images. Bump prod compose **manager + migrate** to `0.89.0` (data-plane unchanged — no Go code touched; bump optional for tag discipline).
- Smoke: `/login` 200; `/admin/policy` shows the selector.
- `gh release edit v0.89.0` with an English user-facing note (keystroke logging is now governed centrally; `required` mode for compliance).

## Self-Review

- **Spec coverage:** storage (T1), resolver (T1), pure helper + tests (T2), descriptor wiring (T3), policy form (T4), site-form reflection incl. create + edit (T5), rollout (Deploy section). All spec sections mapped.
- **Placeholder scan:** none — every code step has concrete content; UI snippets note "adapt class names to the file's actual markup" because the exact CSS classes must match neighbours, but the intended structure and copy are given verbatim.
- **Type consistency:** `KeystrokeMode` defined in T1, imported in T2/T3/T5; `effectiveKeystrokeLogging` signature identical across T2 (def), T3 (call). `keystrokeLoggingMode` field name identical across schema, interface, resolver, route, form.
