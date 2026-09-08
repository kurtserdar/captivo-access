# Self-host Capabilities On By Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the four Pro capability env gates (`NATIVE_GATEWAY`, `ISOLATED_ENABLED`, `VAULT_ENABLED`, `RECORDING_ENABLED`) to default-ON (opt-out) via a shared `flagOn` helper, keeping `MULTI_TENANT` default-OFF, so a fresh self-host install ships with the full product working.

**Architecture:** One `flagOn(raw, defaultValue)` parser; each gate function routes through it with its classified default. Deploy artifacts/docs updated to match. No schema, connector, or SaaS change.

**Tech Stack:** TypeScript, vitest. Spec: `docs/superpowers/specs/2026-09-08-capabilities-on-by-default-design.md`.

## Global Constraints

- English only in the repo (code, comments, console/UI strings). No Claude attribution in commits/PRs.
- **`MULTI_TENANT` MUST stay default-OFF** — the single critical invariant; test-guarded. Any accidental flip makes every self-host install enter multi-tenant mode.
- Deliberate, approved self-host default change (the four Pro gates go on-by-default); NOT byte-identical, by design.
- Deploy + release-note steps are separate standing gates requiring explicit user approval.

---

### Task 1: `flagOn` helper + re-point the gates + tests

**Files:**
- Create: `src/lib/env-flag.ts`, `src/lib/env-flag.test.ts`
- Modify: `src/lib/gateway/native.ts`, `src/lib/isolation/enabled.ts`, `src/lib/vault/enabled.ts`, `src/lib/recording/enabled.ts`, `src/lib/tenant/enabled.ts`
- Modify: `src/lib/isolation/enabled.test.ts`, `src/lib/recording/enabled.test.ts`, `src/lib/vault/enabled.test.ts` (update to new default-ON/opt-out semantics)
- Create: `src/lib/gateway/native.test.ts`, `src/lib/tenant/enabled.test.ts` (new — assert defaults; MULTI_TENANT default-OFF is the critical one)

**Interfaces:**
- Produces: `flagOn(raw: string | undefined, defaultValue: boolean): boolean` (`src/lib/env-flag.ts`). Gate function names/signatures are unchanged (`nativeGatewayEnabled`, `isolationEnabled`, `vaultEnabled`, `recordingEnabled`, `multiTenantEnabled`).

- [ ] **Step 1: Write the failing `flagOn` unit test**

```ts
// src/lib/env-flag.test.ts
import { describe, it, expect } from "vitest";
import { flagOn } from "./env-flag";

describe("flagOn", () => {
  it("recognizes on-tokens → true (any default)", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE", " On "]) {
      expect(flagOn(v, false)).toBe(true);
      expect(flagOn(v, true)).toBe(true);
    }
  });
  it("recognizes off-tokens → false (any default)", () => {
    for (const v of ["0", "false", "off", "no", "OFF", " No "]) {
      expect(flagOn(v, true)).toBe(false);
      expect(flagOn(v, false)).toBe(false);
    }
  });
  it("unset/empty/unknown → the default", () => {
    for (const v of [undefined, "", "  ", "maybe", "2"]) {
      expect(flagOn(v, true)).toBe(true);
      expect(flagOn(v, false)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/env-flag.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `flagOn`**

```ts
// src/lib/env-flag.ts
// Parse a boolean capability env var with an explicit default when unset/unknown.
// On: "1" | "true" | "on" | "yes"   Off: "0" | "false" | "off" | "no"
// Anything else (unset, empty, unrecognized) → defaultValue.
export function flagOn(raw: string | undefined, defaultValue: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return defaultValue;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/env-flag.test.ts` — Expected: PASS.

- [ ] **Step 5: Re-point the five gate functions**

Preserve each function's name, signature, and its leading comment (update the comment to say "on by default" for the four Pro gates). Bodies:

```ts
// src/lib/gateway/native.ts
import { flagOn } from "@/lib/env-flag";
export function nativeGatewayEnabled(): boolean { return flagOn(process.env.NATIVE_GATEWAY, true); }

// src/lib/isolation/enabled.ts
import { flagOn } from "@/lib/env-flag";
export function isolationEnabled(): boolean { return flagOn(process.env.ISOLATED_ENABLED, true); }

// src/lib/vault/enabled.ts
import { flagOn } from "@/lib/env-flag";
export function vaultEnabled(): boolean { return flagOn(process.env.VAULT_ENABLED, true); }

// src/lib/recording/enabled.ts
import { flagOn } from "@/lib/env-flag";
export function recordingEnabled(): boolean { return flagOn(process.env.RECORDING_ENABLED, true); }

// src/lib/tenant/enabled.ts — DEFAULT STAYS FALSE (opt-in), routed through the helper for consistency
import { flagOn } from "@/lib/env-flag";
export function multiTenantEnabled(): boolean { return flagOn(process.env.MULTI_TENANT, false); }
```
(Keep any other exports in these files unchanged. `src/lib/tenant/enabled.ts` also exports `DEFAULT_TENANT`/`PLATFORM_TENANT_ID`-style constants in some files — do not touch them.)

- [ ] **Step 6: Update the three existing gate tests to the new semantics**

For `src/lib/isolation/enabled.test.ts`, `src/lib/recording/enabled.test.ts`, `src/lib/vault/enabled.test.ts`: each currently asserts opt-in (unset/`0` → false, `1` → true). Update to:
- unset (delete the env var) → **true** (new default-on),
- explicit `0`/`false`/`off` → false,
- explicit `1`/`true`/`on` → true.
Each test must `delete process.env.<VAR>` (and restore in afterEach) to exercise the unset→true case deterministically.

- [ ] **Step 7: Add the two missing gate tests**

```ts
// src/lib/tenant/enabled.test.ts  — MULTI_TENANT MUST default OFF (critical invariant)
import { describe, it, expect, afterEach } from "vitest";
import { multiTenantEnabled } from "./enabled";
afterEach(() => { delete process.env.MULTI_TENANT; });
describe("multiTenantEnabled", () => {
  it("unset → false (self-host default)", () => { delete process.env.MULTI_TENANT; expect(multiTenantEnabled()).toBe(false); });
  it("explicit on → true", () => { process.env.MULTI_TENANT = "1"; expect(multiTenantEnabled()).toBe(true); });
  it("explicit off → false", () => { process.env.MULTI_TENANT = "off"; expect(multiTenantEnabled()).toBe(false); });
});
```
```ts
// src/lib/gateway/native.test.ts — NATIVE_GATEWAY defaults ON
import { describe, it, expect, afterEach } from "vitest";
import { nativeGatewayEnabled } from "./native";
afterEach(() => { delete process.env.NATIVE_GATEWAY; });
describe("nativeGatewayEnabled", () => {
  it("unset → true (on by default)", () => { delete process.env.NATIVE_GATEWAY; expect(nativeGatewayEnabled()).toBe(true); });
  it("explicit off → false", () => { process.env.NATIVE_GATEWAY = "0"; expect(nativeGatewayEnabled()).toBe(false); });
  it("explicit on → true", () => { process.env.NATIVE_GATEWAY = "true"; expect(nativeGatewayEnabled()).toBe(true); });
});
```

- [ ] **Step 8: Run the full suite; fix fallout from the flipped defaults**

Run: `npx vitest run`
Expected: the gate tests pass. Some OTHER unit/integration tests may now fail because they implicitly relied on a Pro gate being off when its env was unset (recording/gateway/isolation/vault). For each such failure, fix it by setting the env var EXPLICITLY in that test (e.g. `process.env.RECORDING_ENABLED = "0"`), NOT by weakening the gate. Do NOT touch any test's `MULTI_TENANT` expectation — that default is unchanged. Re-run until green. List every test you had to adjust in your report.
(DB-gated integration tests skip without `TEST_DATABASE_URL`; the controller runs those separately — but if any of them hardcodes an assumption about a default-off gate, note it for the controller.)

- [ ] **Step 9: Typecheck/build**

Run: `pnpm typecheck` and `npm run build` — Expected: green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/env-flag.ts src/lib/env-flag.test.ts \
        src/lib/gateway/native.ts src/lib/gateway/native.test.ts \
        src/lib/isolation/enabled.ts src/lib/isolation/enabled.test.ts \
        src/lib/vault/enabled.ts src/lib/vault/enabled.test.ts \
        src/lib/recording/enabled.ts src/lib/recording/enabled.test.ts \
        src/lib/tenant/enabled.ts src/lib/tenant/enabled.test.ts \
        docs/superpowers/specs/2026-09-08-capabilities-on-by-default-design.md \
        docs/superpowers/plans/2026-09-08-capabilities-on-by-default.md
# plus any test files adjusted in Step 8
git commit -m "feat(capabilities): default the Pro capability gates ON (opt-out) for self-host; keep MULTI_TENANT opt-in"
```

---

### Task 2: Deploy artifacts + docs reflect on-by-default

**Files:**
- Modify: `deploy/.env.prod.example`
- Modify: `deploy/docker-compose.prod.yml` (the flag comments)

**Interfaces:** none (docs/config only).

- [ ] **Step 1: Update `deploy/.env.prod.example`**

Change the four flags from the commented "off by default; set to 1 to enable" form to documented on-by-default. For each of `NATIVE_GATEWAY`, `ISOLATED_ENABLED`, `VAULT_ENABLED`, `RECORDING_ENABLED`, replace the enable-hint with a disable-hint, e.g.:
```
# Remote-desktop gateway (RDP/SSH/VNC). ON by default; uncomment to disable.
# NATIVE_GATEWAY=0
# Isolated browser (RBI). ON by default; uncomment to disable.
# ISOLATED_ENABLED=0
# Credential vault (required for remote-session logins). ON by default; uncomment to disable.
# VAULT_ENABLED=0
# Session recording. ON by default; uncomment to disable.
# RECORDING_ENABLED=0
```
Leave the `MULTI_TENANT` guidance unchanged (off by default; this is a self-host install file and must stay single-tenant).

- [ ] **Step 2: Update `deploy/docker-compose.prod.yml` comments**

The manager-service comments that currently say "Off by default; set to 1 to expose …" for `NATIVE_GATEWAY`, `ISOLATED_ENABLED`, `VAULT_ENABLED`, and `RECORDING_ENABLED` → change to "On by default; set to 0 to disable." Do not change the `${VAR:-}` interpolation (it correctly passes an unset var as empty, and `flagOn` treats empty → default). Do not change the `MULTI_TENANT` comment/behavior.

- [ ] **Step 3: Sanity-check the compose still parses + commit**

Run: `docker compose -f deploy/docker-compose.prod.yml config >/dev/null` (if docker is available) — Expected: no error. Otherwise visually confirm only comments changed.
```bash
git add deploy/.env.prod.example deploy/docker-compose.prod.yml
git commit -m "docs(deploy): self-host ships the Pro capabilities on by default"
```

---

## Self-Review

**Spec coverage:** §1 helper → Task 1 Steps 1-4. §2 re-point gates → Task 1 Step 5. §3 deploy artifacts → Task 2. §4 deliberate change → covered by the tests (Task 1 Steps 6-8) proving new defaults. Testing § → Task 1 Steps 1,6,7,8. Classification (which flip / MULTI_TENANT stays off) → Step 5 + the guard test in Step 7. Out-of-scope items (consent/watermark/recordingMode/externalAnchor) → untouched (not in any file list).

**Placeholder scan:** none — `flagOn` and all gate bodies are concrete; test bodies concrete; the Step 8 fallout list is produced by running the suite, not guessed.

**Type consistency:** `flagOn` signature defined in Task 1 and used by all five gates; gate function names/signatures unchanged so all existing callers keep working.

**Critical-invariant check:** `multiTenantEnabled()` default stays `false` (Step 5 passes `false`) and is asserted by a dedicated test (Step 7) — the plan cannot silently flip it.
