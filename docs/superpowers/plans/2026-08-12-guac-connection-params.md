# Guacamole Connection Parameters (E1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins set a curated set of Guacamole connection parameters (keyboard layout, colour depth, RDP visual toggles) as global Policy defaults and per-resource overrides, injected into the guacd handshake, and make the existing clipboard control apply to gateway resources.

**Architecture:** A pure TS module validates/resolves the params (resource-over-policy). They persist as JSON on `VaultCredential`/`PlatformSettings`; the gateway descriptor route resolves them into a guacd arg-name→value map; the data-plane's `buildConnect` emits them. UI on the Policy page (defaults) and the resource form (overrides).

**Tech Stack:** Next.js 16 / React 19, Prisma 7, Go (data-plane), vitest + go test.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **Curated keys only** — the manager validates against the allowlist before persisting; unknown keys / out-of-range values are dropped (no arbitrary guacd-arg injection).
- Params are **gateway-only** (remote-desktop). Resolution is **per-field: resource value ?? policy default ?? guacd default (omit)**.
- Clipboard is the **existing `Site.clipboardMode`** (`allow`/`no_copy`/`no_paste`/`none`), now mapped to guacd `disable-copy`/`disable-paste` for gateway too.
- guacd arg names: `server-layout`, `color-depth`, `enable-wallpaper`, `enable-theming`, `enable-font-smoothing`, `enable-full-window-drag`, `disable-copy`, `disable-paste`.
- **Schema change** → the deploy must bump **both** `access-manager` and `access-migrate` and run migrate.
- **Verify:** `pnpm build`; `pnpm test`; `cd dataplane && go test ./...`.

---

### Task 1: Pure param model + resolver

**Files:**
- Create: `src/lib/gateway/guac-params.ts`
- Test: `src/lib/gateway/guac-params.test.ts`

**Interfaces:**
- Produces: `interface GuacParams`, `KEYBOARD_LAYOUTS`, `parseGuacParams(input): GuacParams`, `resolveGuacParams(resource, policy): GuacParams`, `toGuacArgs(p, clipboardMode): Record<string,string>`.

- [ ] **Step 1: Write the failing test** — `src/lib/gateway/guac-params.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseGuacParams, resolveGuacParams, toGuacArgs } from "./guac-params";

describe("parseGuacParams", () => {
  it("keeps curated valid keys and drops the rest", () => {
    expect(parseGuacParams({
      serverLayout: "tr-tr-qwerty", colorDepth: 16, enableWallpaper: true,
      serverLayout2: "x", colorDepth99: 99, evil: "rm -rf",
    })).toEqual({ serverLayout: "tr-tr-qwerty", colorDepth: 16, enableWallpaper: true });
  });
  it("rejects an unknown layout and out-of-range colour depth", () => {
    expect(parseGuacParams({ serverLayout: "xx-yy-zzz", colorDepth: 99 })).toEqual({});
  });
  it("returns {} for non-objects", () => {
    expect(parseGuacParams(null)).toEqual({});
    expect(parseGuacParams("nope")).toEqual({});
  });
});

describe("resolveGuacParams", () => {
  it("prefers the resource value, falls back to policy, leaves unset undefined", () => {
    const r = resolveGuacParams({ colorDepth: 24 }, { serverLayout: "de-de-qwertz", colorDepth: 8 });
    expect(r.colorDepth).toBe(24);            // resource wins
    expect(r.serverLayout).toBe("de-de-qwertz"); // policy fallback
    expect(r.enableWallpaper).toBeUndefined();   // neither set
  });
});

describe("toGuacArgs", () => {
  it("emits set/true params and maps clipboardMode", () => {
    expect(toGuacArgs({ serverLayout: "tr-tr-qwerty", colorDepth: 16, enableWallpaper: true, enableTheming: false }, "no_copy"))
      .toEqual({ "server-layout": "tr-tr-qwerty", "color-depth": "16", "enable-wallpaper": "true", "disable-copy": "true" });
  });
  it("clipboardMode none blocks both; allow blocks neither", () => {
    expect(toGuacArgs({}, "none")).toEqual({ "disable-copy": "true", "disable-paste": "true" });
    expect(toGuacArgs({}, "allow")).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/gateway/guac-params.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/gateway/guac-params.ts`**

```ts
export interface GuacParams {
  serverLayout?: string;
  colorDepth?: 8 | 16 | 24;
  enableWallpaper?: boolean;
  enableTheming?: boolean;
  enableFontSmoothing?: boolean;
  enableFullWindowDrag?: boolean;
}

export const KEYBOARD_LAYOUTS: { value: string; label: string }[] = [
  { value: "", label: "Default (US English)" },
  { value: "en-us-qwerty", label: "English (US)" },
  { value: "en-gb-qwerty", label: "English (UK)" },
  { value: "tr-tr-qwerty", label: "Turkish-Q" },
  { value: "de-de-qwertz", label: "German" },
  { value: "de-ch-qwertz", label: "German (Swiss)" },
  { value: "fr-fr-azerty", label: "French" },
  { value: "fr-be-azerty", label: "French (Belgian)" },
  { value: "fr-ch-qwertz", label: "French (Swiss)" },
  { value: "es-es-qwerty", label: "Spanish" },
  { value: "es-latam-qwerty", label: "Spanish (Latin American)" },
  { value: "it-it-qwerty", label: "Italian" },
  { value: "ja-jp-qwerty", label: "Japanese" },
  { value: "pt-br-qwerty", label: "Portuguese (Brazilian)" },
  { value: "sv-se-qwerty", label: "Swedish" },
  { value: "no-no-qwerty", label: "Norwegian" },
  { value: "hu-hu-qwertz", label: "Hungarian" },
];

const LAYOUTS = new Set(KEYBOARD_LAYOUTS.map((l) => l.value).filter(Boolean));
const DEPTHS = new Set([8, 16, 24]);
const BOOL_KEYS = ["enableWallpaper", "enableTheming", "enableFontSmoothing", "enableFullWindowDrag"] as const;

// Coerce untrusted JSON into GuacParams, keeping ONLY curated keys with valid values.
export function parseGuacParams(input: unknown): GuacParams {
  const out: GuacParams = {};
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;
  if (typeof o.serverLayout === "string" && LAYOUTS.has(o.serverLayout)) out.serverLayout = o.serverLayout;
  if (typeof o.colorDepth === "number" && DEPTHS.has(o.colorDepth)) out.colorDepth = o.colorDepth as 8 | 16 | 24;
  for (const k of BOOL_KEYS) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  return out;
}

// Per-field: resource value if present, else policy default. (undefined = guacd default.)
export function resolveGuacParams(resource: GuacParams, policy: GuacParams): GuacParams {
  return {
    serverLayout: resource.serverLayout ?? policy.serverLayout,
    colorDepth: resource.colorDepth ?? policy.colorDepth,
    enableWallpaper: resource.enableWallpaper ?? policy.enableWallpaper,
    enableTheming: resource.enableTheming ?? policy.enableTheming,
    enableFontSmoothing: resource.enableFontSmoothing ?? policy.enableFontSmoothing,
    enableFullWindowDrag: resource.enableFullWindowDrag ?? policy.enableFullWindowDrag,
  };
}

// Map resolved params + clipboardMode → guacd arg-name→value (only set/true fields).
export function toGuacArgs(p: GuacParams, clipboardMode: string): Record<string, string> {
  const a: Record<string, string> = {};
  if (p.serverLayout) a["server-layout"] = p.serverLayout;
  if (p.colorDepth) a["color-depth"] = String(p.colorDepth);
  if (p.enableWallpaper) a["enable-wallpaper"] = "true";
  if (p.enableTheming) a["enable-theming"] = "true";
  if (p.enableFontSmoothing) a["enable-font-smoothing"] = "true";
  if (p.enableFullWindowDrag) a["enable-full-window-drag"] = "true";
  if (clipboardMode === "no_copy" || clipboardMode === "none") a["disable-copy"] = "true";
  if (clipboardMode === "no_paste" || clipboardMode === "none") a["disable-paste"] = "true";
  return a;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/gateway/guac-params.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gateway/guac-params.ts src/lib/gateway/guac-params.test.ts
git commit -m "feat(gateway): curated Guacamole connection-param model + resolver"
```

---

### Task 2: Schema + storage plumbing

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/settings/platform.ts`, `src/lib/vault/store.ts`, `src/lib/site/validate.ts`

**Interfaces:**
- Consumes: `parseGuacParams`, `GuacParams` (Task 1).
- Produces: `resolvedGuacParamDefaults(): Promise<GuacParams>`; `guacParams` persisted on `VaultCredential`; `getVaultCredential` returns `guacParams`.

> No unit test (schema + DB plumbing; validation covered by Task 1). Verified by `pnpm build` + `pnpm db:push`.

- [ ] **Step 1: Add the schema columns**

In `prisma/schema.prisma`:
- `VaultCredential`: add `guacParams Json?` (after `secretKind`).
- `PlatformSettings`: add `guacParamDefaults Json?` (before `updatedAt`).
- Update the `Site.clipboardMode` comment: `// allow | no_copy | no_paste | none (web via proxy; gateway via guacd disable-copy/disable-paste)`.

- [ ] **Step 2: Push the schema (dev DB)**

Run: `export DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's#access-postgres:5432#localhost:5434#') && pnpm exec prisma db push && pnpm db:generate`
Expected: additive push succeeds; Prisma client regenerated with the two `Json?` fields.

- [ ] **Step 3: Add the settings accessor** — in `src/lib/settings/platform.ts`

```ts
import { parseGuacParams, type GuacParams } from "@/lib/gateway/guac-params";

export async function resolvedGuacParamDefaults(): Promise<GuacParams> {
  const s = await getPlatformSettings();
  return parseGuacParams(s.guacParamDefaults);
}
```

(Place it next to the other `resolved*` accessors; `getPlatformSettings()` already exists in this file.)

- [ ] **Step 4: Persist + read `guacParams` on the vault credential** — in `src/lib/vault/store.ts`

Read the current `getVaultCredential` and `setVaultCredential` (or upsert) signatures first. Then:
- Add `guacParams: true` to `getVaultCredential`'s `select`, and return it on the result object.
- In the create/update (upsert) path, accept an optional `guacParams` value and write it to the `guacParams` column, running it through `parseGuacParams(...)` first so only curated keys persist. (Prisma `Json?` accepts a plain object; pass `parseGuacParams(input) as Prisma.InputJsonValue`.)

- [ ] **Step 5: Accept `guacParams` in the resource validator** — in `src/lib/site/validate.ts`

Add `guacParams` to the validated gateway payload: read `body.guacParams`, run `parseGuacParams(...)`, and include it in the returned object so the create/update route can pass it to `setVaultCredential`. (Import `parseGuacParams` from `@/lib/gateway/guac-params`.)

- [ ] **Step 6: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/settings/platform.ts src/lib/vault/store.ts src/lib/site/validate.ts
git commit -m "feat(gateway): persist guacParams on the vault + policy defaults"
```

---

### Task 3: Descriptor resolution + data-plane handshake

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`, `dataplane/controlclient.go`, `dataplane/guacproto.go`
- Test: `dataplane/guacproto_test.go`

**Interfaces:**
- Consumes: `resolveGuacParams`, `parseGuacParams`, `toGuacArgs` (Task 1); `resolvedGuacParamDefaults` (Task 2); `getVaultCredential` returning `guacParams` (Task 2).
- Produces: descriptor JSON field `params: Record<string,string>`; `GuacConn.Params` consumed by `buildConnect`.

- [ ] **Step 1: Resolve params in the descriptor route** — `src/app/api/internal/gateway/descriptor/route.ts`

- Add `clipboardMode: true` to the `site` `select`.
- After fetching `cred`, resolve + map:
  ```ts
  import { parseGuacParams, resolveGuacParams, toGuacArgs } from "@/lib/gateway/guac-params";
  import { resolvedGuacParamDefaults } from "@/lib/settings/platform";
  // …
  const resolved = resolveGuacParams(parseGuacParams(cred.guacParams), await resolvedGuacParamDefaults());
  const params = toGuacArgs(resolved, site.clipboardMode);
  ```
- Add `params` to the returned JSON (alongside `protocol`, `targetHost`, …).

- [ ] **Step 2: Carry params through the data-plane** — `dataplane/controlclient.go`

- In the `GatewayDescriptor` response struct, add `Params map[string]string \`json:"params"\``.
- Where it builds the returned `GuacConn`, set `Params: out.Params`.
- In `dataplane/guacproto.go`, add `Params map[string]string` to the `GuacConn` struct (after `Width, Height, Dpi`).

- [ ] **Step 3: Write the failing Go test** — append to `dataplane/guacproto_test.go`

```go
func TestBuildConnectEmitsParamForListedArg(t *testing.T) {
	names := []string{"VERSION_1_5_0", "hostname", "server-layout", "enable-wallpaper"}
	c := GuacConn{Hostname: "h", Params: map[string]string{"server-layout": "tr-tr-qwerty", "enable-wallpaper": "true"}}
	got := string(buildConnect(names, c))
	if !strings.Contains(got, "13.tr-tr-qwerty") || !strings.Contains(got, "4.true") {
		t.Fatalf("params not emitted: %s", got)
	}
}
```

(If `strings` isn't already imported in the test file, add it.)

- [ ] **Step 4: Run it to verify it fails**

Run: `cd dataplane && go test ./... -run TestBuildConnectEmitsParamForListedArg`
Expected: FAIL — the `default` case emits empty, not the param value.

- [ ] **Step 5: Make `buildConnect` consult the param map** — `dataplane/guacproto.go`

Replace the `default:` case:

```go
		default:
			if v, ok := c.Params[name]; ok {
				elems = append(elems, v)
			} else {
				elems = append(elems, "")
			}
```

- [ ] **Step 6: Run tests**

Run: `cd dataplane && go test ./...`
Expected: PASS (new test + existing). Then `pnpm build` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/internal/gateway/descriptor/route.ts" dataplane/controlclient.go dataplane/guacproto.go dataplane/guacproto_test.go
git commit -m "feat(gateway): resolve + inject connection params into the guacd handshake"
```

---

### Task 4: UI — Policy defaults + resource overrides

**Files:**
- Modify: `src/app/(app)/admin/policy/platform-settings-form.tsx` + its save route, `src/app/(app)/admin/sites/site-form.tsx` + the site create/update route.

**Interfaces:**
- Consumes: `KEYBOARD_LAYOUTS`, `GuacParams` (Task 1); the persistence from Task 2.

> No unit test (form UI). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Policy "Remote-desktop defaults" section** — `platform-settings-form.tsx`

Add a settings block with: a keyboard-layout `<select>` (options from `KEYBOARD_LAYOUTS`), a colour-depth `<select>` (`Default` / `24` / `16` / `8`), and four checkboxes (wallpaper / theming / font-smoothing / full-window-drag). Wire them into the form state initialised from the existing settings prop's `guacParamDefaults`, and include a `guacParamDefaults` object in the POST body. Update the settings **save route** to `parseGuacParams(body.guacParamDefaults)` and write it to `PlatformSettings.guacParamDefaults`.

- [ ] **Step 2: Resource form "Advanced (Guacamole)" section** — `site-form.tsx`

On the gateway branch, add a `<details>` "Advanced (Guacamole)" section, shown **per protocol**:
- **RDP:** keyboard layout, colour depth, the four visual toggles.
- **VNC:** colour depth only.
- **SSH:** none (a short note that clipboard applies via the Clipboard control).

Each control includes a **"Use policy default"** empty option (layout/depth) or a tri-state where an unchecked toggle means "unset → default". Collect them into a `guacParams` object (only explicitly-set fields) and include it in the create/update submit body. Initialise from the existing resource's `guacParams` when editing.

- [ ] **Step 3: Persist `guacParams` on create/update** — the site create/update route

Ensure the gateway create/update route passes the validator's `guacParams` (Task 2, Step 5) into `setVaultCredential`. (If the route already spreads the validated object into the vault upsert, confirm `guacParams` is included.)

- [ ] **Step 4: Verify build + full test**

Run: `pnpm build` — Expected: PASS. `pnpm test` — Expected: all pass. `cd dataplane && go test ./...` — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/policy" "src/app/(app)/admin/sites/site-form.tsx"
git commit -m "feat(gateway): policy defaults + per-resource overrides UI for connection params"
```

- [ ] **Step 6: Gate A — live validation (operator, after deploy)**

After deploy (bump **manager + migrate**, run migrate; data-plane also rebuilt):
1. Policy → set keyboard default `Turkish-Q`; connect to an RDP resource → the remote session uses the Turkish-Q layout.
2. On one RDP resource, override colour depth to `16` and enable wallpaper → that resource reflects the override; others still use the policy default.
3. Set a gateway resource's Clipboard to **Block both** → copy and paste are blocked inside the session.
4. VNC resource shows only colour depth under Advanced; SSH shows none.

---

## Self-Review

**1. Spec coverage:**
- Curated param model + `parseGuacParams`/`resolveGuacParams`/`toGuacArgs` + `KEYBOARD_LAYOUTS` → Task 1. ✓
- Schema (`VaultCredential.guacParams`, `PlatformSettings.guacParamDefaults`, clipboardMode comment) + storage/validation + `resolvedGuacParamDefaults` → Task 2. ✓
- Descriptor resolution (`params` map, clipboard from `clipboardMode`) + data-plane `Params` + `buildConnect` → Task 3. ✓
- Policy defaults UI + resource protocol-aware Advanced UI + persistence → Task 4. ✓
- Clipboard reuse of `clipboardMode` (no new storage) → Task 1 `toGuacArgs` + Task 3 descriptor + Task 2 comment. ✓
- Curated-keys-only validation (security) → `parseGuacParams` applied on every persist + on resolve. ✓
- Testing (TS helpers + Go buildConnect + Gate A) → Task 1 + Task 3 + Task 4. ✓
- Deploy: manager + migrate bump → Global Constraints + Task 4 Gate A note. ✓

**2. Placeholder scan:** No TBD/TODO. Task 1 and Task 3's handshake carry complete code; the storage/UI steps that depend on existing signatures instruct the implementer to read the exact signature first, then give the concrete change — appropriate for plumbing into existing files, not a vague placeholder.

**3. Type consistency:**
- `GuacParams` shape (Task 1) is what `parseGuacParams`/`resolveGuacParams`/`toGuacArgs`, the vault store, the descriptor, and both forms use. ✓
- guacd arg names in `toGuacArgs` (`server-layout`, `color-depth`, `enable-*`, `disable-copy/paste`) are the exact strings `buildConnect` matches by name. ✓
- `GuacConn.Params map[string]string` (Task 3) matches the descriptor's `params: Record<string,string>` JSON and `GatewayDescriptor.Params`. ✓
- `clipboardMode` values `allow`/`no_copy`/`no_paste`/`none` (existing) are what `toGuacArgs` switches on. ✓
