# Policy-level Clipboard Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-wide `PlatformSettings.clipboardDefault` that resources inherit when `Site.clipboardMode` is null, mirroring the existing `watermarkDefault` pattern.

**Architecture:** `Site.clipboardMode` becomes nullable (`null = inherit`). Every server-side consumer resolves `site.clipboardMode ?? resolvedClipboardDefault()` to a concrete `allow|no_copy|no_paste|none` before emitting it, so the data-plane and browser never see the sentinel and stay unchanged.

**Tech Stack:** Next.js (TypeScript, App Router), Prisma (`db push`, no migration files), Vitest.

## Global Constraints

- English-only for all code, comments, console output, and UI copy.
- No Claude signature in commits/PRs.
- Deploy needs explicit user approval; the data-migration SQL runs only as part of an approved deploy.
- Schema ships via `prisma db push` (no migration files).
- Concrete clipboard modes are exactly `allow | no_copy | no_paste | none`. The inherit sentinel is `null` in the DB and `"inherit"` in form/UI state; it is NEVER sent to the data-plane or browser.
- `clipboardDefault` has no env fallback (UI-only control); when unset it resolves to `"allow"` (behavior-preserving).

---

### Task 1: Schema — nullable clipboardMode + clipboardDefault

**Files:**
- Modify: `prisma/schema.prisma` (Site model line 157; PlatformSettings model ~line 421)

**Interfaces:**
- Produces: `Site.clipboardMode: string | null` (null = inherit) and `PlatformSettings.clipboardDefault: string | null` in the generated Prisma client, consumed by every later task.

- [ ] **Step 1: Make `Site.clipboardMode` nullable**

In `prisma/schema.prisma`, change the Site field:
```prisma
  clipboardMode      String?       // null = inherit PlatformSettings.clipboardDefault; else allow | no_copy | no_paste | none
```
(Remove the `@default("allow")`.)

- [ ] **Step 2: Add `PlatformSettings.clipboardDefault`**

In the `PlatformSettings` model, next to `watermarkDefault`, add:
```prisma
  clipboardDefault         String?  // global clipboard default for inheriting resources; null = "allow"
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 4: Regenerate the client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". Confirm `src/generated/prisma/models/Site.ts` shows `clipboardMode: string | null`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma
git commit -m "feat(clipboard): nullable Site.clipboardMode + PlatformSettings.clipboardDefault"
```

---

### Task 2: Platform settings resolver

**Files:**
- Modify: `src/lib/settings/platform.ts`
- Test: `src/lib/settings/clipboard-default.test.ts` (create)

**Interfaces:**
- Consumes: `PlatformSettings` interface, `getPlatformSettings()` from Task-1 client.
- Produces: `CLIPBOARD_MODES: string[]`, `coerceClipboardDefault(v: string | null): string` (pure), `resolvedClipboardDefault(): Promise<string>`. The `PlatformSettings` interface gains `clipboardDefault: string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/settings/clipboard-default.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { coerceClipboardDefault, CLIPBOARD_MODES } from "./platform";

describe("coerceClipboardDefault", () => {
  it("returns a valid stored mode unchanged", () => {
    for (const m of CLIPBOARD_MODES) expect(coerceClipboardDefault(m)).toBe(m);
  });
  it("falls back to allow when null", () => {
    expect(coerceClipboardDefault(null)).toBe("allow");
  });
  it("falls back to allow on an unknown value", () => {
    expect(coerceClipboardDefault("garbage")).toBe("allow");
    expect(coerceClipboardDefault("inherit")).toBe("allow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/settings/clipboard-default.test.ts`
Expected: FAIL — `coerceClipboardDefault`/`CLIPBOARD_MODES` not exported.

- [ ] **Step 3: Implement**

In `src/lib/settings/platform.ts`:
- Add `clipboardDefault: string | null;` to the `PlatformSettings` interface (after `watermarkDefault`).
- Add `clipboardDefault: null,` to the `EMPTY` constant.
- Add `clipboardDefault: c?.clipboardDefault ?? null,` to the `getPlatformSettings()` mapping object.
- Add near `resolvedWatermarkDefault`:
```ts
export const CLIPBOARD_MODES = ["allow", "no_copy", "no_paste", "none"];

// Coerce a stored clipboard default to a concrete mode; unknown/null → "allow".
export function coerceClipboardDefault(v: string | null): string {
  return v && CLIPBOARD_MODES.includes(v) ? v : "allow";
}

// Tenant-wide clipboard default for resources that inherit (Site.clipboardMode
// is null). DB value if valid, else "allow". No env fallback (UI-only control).
export async function resolvedClipboardDefault(): Promise<string> {
  const s = await getPlatformSettings();
  return coerceClipboardDefault(s.clipboardDefault);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/settings/clipboard-default.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings/platform.ts src/lib/settings/clipboard-default.test.ts
git commit -m "feat(clipboard): resolvedClipboardDefault + platform settings plumbing"
```

---

### Task 3: Site input validation — accept inherit → null

**Files:**
- Modify: `src/lib/site/validate.ts`
- Test: `src/lib/site/validate.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SiteValidation` TRANSPARENT and ISOLATED variants carry `clipboardMode: string | null`; `"inherit"`/unknown map to `null`, concrete modes pass through.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/site/validate.test.ts` (inside the top-level `describe`), a base ISOLATED body helper if not present, then:
```ts
it("maps inherit clipboardMode to null", () => {
  const r = validateSiteInput(
    { accessMode: "ISOLATED", connectorId: "c1", name: "n", upstreamUrl: "https://x.example", clipboardMode: "inherit" },
    { nativeGateway: true, requireSecret: false, recordingEnabled: true, isolationEnabled: true },
  );
  expect(r.ok).toBe(true);
  if (r.ok && r.mode === "ISOLATED") expect(r.clipboardMode).toBeNull();
});

it("passes a concrete clipboardMode through", () => {
  const r = validateSiteInput(
    { accessMode: "ISOLATED", connectorId: "c1", name: "n", upstreamUrl: "https://x.example", clipboardMode: "no_copy" },
    { nativeGateway: true, requireSecret: false, recordingEnabled: true, isolationEnabled: true },
  );
  if (r.ok && r.mode === "ISOLATED") expect(r.clipboardMode).toBe("no_copy");
});

it("maps an unknown clipboardMode to null (inherit)", () => {
  const r = validateSiteInput(
    { accessMode: "TRANSPARENT", connectorId: "c1", name: "n", hostname: "h.example", upstreamUrl: "https://x.example", clipboardMode: "garbage" },
    { nativeGateway: true, requireSecret: false, recordingEnabled: true, isolationEnabled: true },
  );
  if (r.ok && r.mode === "TRANSPARENT") expect(r.clipboardMode).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/site/validate.test.ts`
Expected: FAIL — currently returns `"allow"`, not `null`.

- [ ] **Step 3: Implement**

In `src/lib/site/validate.ts`:
- In the `SiteValidation` type, change `clipboardMode: string;` to `clipboardMode: string | null;` in BOTH the TRANSPARENT variant (line ~17) and the ISOLATED variant (line ~44).
- ISOLATED branch (line ~80): replace
  `clipboardMode: CLIP.includes(clip) ? clip : "allow",`
  with
  `clipboardMode: CLIP.includes(clip) ? clip : null,`
- TRANSPARENT branch (line ~125): replace
  `const clipboardMode = CLIP.includes(clip) ? clip : "allow";`
  with
  `const clipboardMode = CLIP.includes(clip) ? clip : null;`

(`"inherit"` is not in `CLIP`, so it maps to `null` automatically — no special case.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/site/validate.test.ts`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/site/validate.ts src/lib/site/validate.test.ts
git commit -m "feat(clipboard): validate inherit clipboardMode as null"
```

---

### Task 4: Resolve inherit at the descriptor + by-host consumers

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`
- Modify: `src/app/api/internal/site/by-host/route.ts`

**Interfaces:**
- Consumes: `resolvedClipboardDefault()` from Task 2.
- Produces: both routes emit a concrete clipboard mode (never null/inherit).

Verification for this task is type-check + build (these route handlers are not unit-tested in this repo; the resolution is `?? resolvedClipboardDefault()`, and Task 2's test covers the resolver).

- [ ] **Step 1: Gateway/isolated descriptor**

In `src/app/api/internal/gateway/descriptor/route.ts`, add `import { resolvedClipboardDefault } from "@/lib/settings/platform";` (extend the existing platform import if present). After the `evaluateAccess` check and before the `ISOLATED` branch, add:
```ts
  const clipboardMode = site.clipboardMode ?? (await resolvedClipboardDefault());
```
Then in the ISOLATED branch replace `clipboardMode: site.clipboardMode,` with `clipboardMode,`. In the GATEWAY path replace `toGuacArgs(resolved, site.clipboardMode, …)` with `toGuacArgs(resolved, clipboardMode, …)`.

- [ ] **Step 2: by-host route**

In `src/app/api/internal/site/by-host/route.ts`, add `import { resolvedClipboardDefault } from "@/lib/settings/platform";` (there is already a `@/lib/settings/platform` import — extend it). Replace line 36:
```ts
    clipboardMode: site.accessMode === "GATEWAY" ? "allow" : (site.clipboardMode ?? (await resolvedClipboardDefault())),
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "descriptor/route|by-host/route" || echo "clean"`
Expected: `clean` (no errors in these files).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/internal/gateway/descriptor/route.ts src/app/api/internal/site/by-host/route.ts
git commit -m "feat(clipboard): resolve inherit at descriptor + by-host consumers"
```

---

### Task 5: Resource form — Inherit option

**Files:**
- Modify: `src/app/(app)/admin/sites/site-form.tsx`

**Interfaces:**
- Consumes: `site.clipboardMode: string | null` from the Prisma client.
- Produces: the form emits `"inherit"` (mapped to null by Task 3's validate) or a concrete mode.

- [ ] **Step 1: Default state to inherit**

Change line ~89:
```tsx
  const [clipboardMode, setClipboardMode] = useState(site?.clipboardMode ?? "inherit");
```
(A null saved value and a brand-new resource both become `"inherit"`.)

- [ ] **Step 2: Add the Inherit option to all three dropdowns**

In each of the three `<select ... value={clipboardMode} ...>` blocks (ISOLATED ~317, GATEWAY ~378, TRANSPARENT ~450), add as the FIRST option:
```tsx
              <option value="inherit">Inherit (policy default)</option>
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "site-form" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/sites/site-form.tsx"
git commit -m "feat(clipboard): Inherit (policy default) option in the resource form"
```

---

### Task 6: Policy form + route — clipboard default control

**Files:**
- Modify: `src/app/(app)/admin/policy/platform-settings-form.tsx`
- Modify: `src/app/api/admin/policy/platform/route.ts`

**Interfaces:**
- Consumes: `initial.clipboardDefault: string | null` (Task 2), `CLIPBOARD_MODES` (Task 2).
- Produces: the settings POST persists `clipboardDefault`.

- [ ] **Step 1: Form state**

In `platform-settings-form.tsx`, near the `watermark` state (line 21) add:
```tsx
  const [clipboardDefault, setClipboardDefault] = useState(initial.clipboardDefault ?? "allow");
```

- [ ] **Step 2: Form payload**

In the `save()` POST body (near `watermarkDefault: watermark,` line 65) add:
```tsx
        clipboardDefault,
```

- [ ] **Step 3: Render the control**

Near the watermark-default field in the JSX, add a select with the four concrete options (NO inherit):
```tsx
        <div className="field">
          <label className="field-label" htmlFor="policy-clipboard">Default clipboard policy</label>
          <select id="policy-clipboard" className="select" value={clipboardDefault} onChange={(e) => setClipboardDefault(e.target.value)}>
            <option value="allow">Allow copy &amp; paste</option>
            <option value="no_copy">Block copy out (no exfil)</option>
            <option value="no_paste">Block paste in</option>
            <option value="none">Block both</option>
          </select>
          <span className="hint">Applied to resources set to <b>Inherit</b>. Per-resource overrides win. <b>Allow</b> keeps the current behavior.</span>
        </div>
```

- [ ] **Step 4: Route parse**

In `src/app/api/admin/policy/platform/route.ts`, add `CLIPBOARD_MODES` to the existing `@/lib/settings/platform` import. In the `savePlatformSettings({ … })` call (after `watermarkDefault: body.watermarkDefault === true,` line 64) add:
```ts
    clipboardDefault: typeof body.clipboardDefault === "string" && CLIPBOARD_MODES.includes(body.clipboardDefault)
      ? body.clipboardDefault
      : null,
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "platform-settings-form|policy/platform/route" || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/admin/policy/platform-settings-form.tsx" src/app/api/admin/policy/platform/route.ts
git commit -m "feat(clipboard): policy-level Default clipboard policy control"
```

---

### Task 7: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all pass, including the new `clipboard-default` and `validate` cases, and unchanged `guac-params` / `clipboard-caps` / any `clipboardToKasm` tests (they only ever receive concrete modes).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles with no errors.

- [ ] **Step 3: Commit (only if any lockfile/generated drift)**

```bash
git status --porcelain
# commit only if something changed
```

---

## Deployment (runs only on explicit approval — NOT part of task execution)

1. Push commits + tag (next patch/minor after current prod v1.1.x — verify with `gh release list` first).
2. CI builds 5 images.
3. Prod: `db push` (via migrate image) applies the nullable column + new field.
4. **Data migration SQL** (one-off, idempotent), run against prod Postgres after `db push`:
   ```sql
   UPDATE "Site" SET "clipboardMode" = NULL WHERE "clipboardMode" = 'allow';
   ```
   Behavior-preserving: `clipboardDefault` resolves to `"allow"` until an admin changes it.
5. Bump prod manager + dataplane (+ migrate) to the release tag; verify login 200.
6. `gh release edit <tag> --notes-file` with an English, user-facing note.

## Self-review notes

- **Spec coverage:** data model (T1), resolver (T2), write path/validate (T3), all three consumers (T4), resource-form UI (T5), policy-form UI + route (T6), tests + build (T7), migration (Deployment §4). All spec sections mapped.
- **Type consistency:** `clipboardMode` is `string | null` in schema (T1), `SiteValidation` (T3), and the two route selects (T4); `resolvedClipboardDefault(): Promise<string>` and `coerceClipboardDefault(string|null): string` names are used identically in T2 and T4/T6; `CLIPBOARD_MODES` defined in T2, imported in T6.
- **Invariant:** null/"inherit" resolved server-side in T4 before reaching data-plane/browser; client + Go code untouched.
