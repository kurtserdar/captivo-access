# RDP Security Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let operators pick the RDP security mode per resource (Automatic/NLA/TLS/RDP, default Automatic), so updated Windows hosts that reject `security=any` ("wrong security type") can connect via NLA.

**Architecture:** New `rdpSecurity` field flows site form → `GuacParams` → `toGuacArgs` → `c.Params["security"]` → `buildConnect` (which defaults to `any` when unset). Default preserves today's behaviour exactly.

**Tech Stack:** TypeScript (guac-params + React form), Go (data-plane buildConnect), Vitest.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- Default **`any`** — unset resources behave exactly as today; no schema change (`rdpSecurity` lives in the existing `guacParams` JSON).
- Curated values only: `any`, `nla`, `tls`, `rdp`. Reject anything else.
- RDP-only — `security` never emitted for SSH/VNC.
- No change to `ignore-cert` / `resize-method`.
- Do NOT deploy without explicit approval (data-plane restart drops live sessions).

---

### Task 1: `guac-params.ts` — field, parse, resolve, emit (+ tests)

**Files:**
- Modify: `src/lib/gateway/guac-params.ts`
- Test: `src/lib/gateway/guac-params.test.ts`

- [ ] **Step 1: Write failing tests.** Add to `guac-params.test.ts`:

```ts
it("parseGuacParams keeps a valid rdpSecurity and drops an invalid one", () => {
  expect(parseGuacParams({ rdpSecurity: "nla" }).rdpSecurity).toBe("nla");
  expect(parseGuacParams({ rdpSecurity: "bogus" }).rdpSecurity).toBeUndefined();
});
it("toGuacArgs emits security for RDP when set, omits it otherwise", () => {
  expect(toGuacArgs({ rdpSecurity: "nla" }, "allow", "RDP")["security"]).toBe("nla");
  expect(toGuacArgs({ rdpSecurity: "nla" }, "allow", "SSH")["security"]).toBeUndefined();
  expect(toGuacArgs({}, "allow", "RDP")["security"]).toBeUndefined();
});
```

- [ ] **Step 2: Run — expect fail.** `pnpm test -- src/lib/gateway/guac-params.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `guac-params.ts`:
  - Interface: add `rdpSecurity?: string;` to `GuacParams`.
  - Add `const RDP_SECURITY = new Set(["any", "nla", "tls", "rdp"]);`
  - `parseGuacParams`: `if (typeof o.rdpSecurity === "string" && RDP_SECURITY.has(o.rdpSecurity)) out.rdpSecurity = o.rdpSecurity;`
  - `resolveGuacParams`: add `rdpSecurity: resource.rdpSecurity ?? policy.rdpSecurity,`
  - `toGuacArgs`: after the RDP-specific args, add (protocol-gated): `if (protocol === "RDP" && p.rdpSecurity) a["security"] = p.rdpSecurity;`

- [ ] **Step 4: Run — expect pass.** `pnpm test -- src/lib/gateway/guac-params.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/gateway/guac-params.ts src/lib/gateway/guac-params.test.ts
git commit -m "feat(gateway): rdpSecurity param — parse, resolve, emit for RDP"
```

---

### Task 2: `buildConnect` — param-aware security (default any)

**Files:**
- Modify: `dataplane/guacproto.go`

- [ ] **Step 1: Make the security case param-aware.** Replace:

```go
		case name == "security":
			elems = append(elems, "any") // RDP: let guacd negotiate (NLA/TLS/RDP)
```

with:

```go
		case name == "security":
			// Resource override (via guacParams) wins; default to negotiate.
			if v, ok := c.Params["security"]; ok && v != "" {
				elems = append(elems, v)
			} else {
				elems = append(elems, "any")
			}
```

- [ ] **Step 2: Build + gofmt + test.**

Run: `cd dataplane && gofmt -w guacproto.go && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add dataplane/guacproto.go
git commit -m "feat(gateway): honor a per-resource RDP security override in buildConnect"
```

---

### Task 3: Site form — RDP security selector

**Files:**
- Modify: `src/components/guac-params-fields.tsx`

**Interfaces:**
- `GuacFields` gains `rdpSecurity: string`; `paramsToGuacFields`/`guacFieldsToParams` map it; the component renders an RDP-only `<select>`.

- [ ] **Step 1: Extend GuacFields + mapping.**
  - `GuacFields` interface: add `rdpSecurity: string;`
  - `EMPTY_GUAC_FIELDS`: add `rdpSecurity: "",`
  - `paramsToGuacFields`: add `rdpSecurity: p.rdpSecurity ?? "",`
  - `guacFieldsToParams`: add `if (f.rdpSecurity) p.rdpSecurity = f.rdpSecurity;`

- [ ] **Step 2: Add the RDP-only selector.** Add `const showSecurity = !protocol || protocol === "RDP";` alongside the other `show*` flags, and render (near the keyboard-layout/perf RDP block, guarded by `showSecurity`):

```tsx
        {showSecurity && (
          <label className="field"><span className="field-label">RDP security {protocol ? "" : "(RDP)"}</span>
            <select className="select" value={value.rdpSecurity} onChange={(e) => set("rdpSecurity", e.target.value)}>
              <option value="">Automatic (negotiate)</option>
              <option value="nla">NLA</option>
              <option value="tls">TLS</option>
              <option value="rdp">RDP (legacy)</option>
            </select>
            <span className="hint">Set to NLA if an updated Windows host refuses the connection (&quot;wrong security type&quot;).</span>
          </label>
        )}
```

(Match the file's exact field markup; wrap the `set` call as the existing selects do.)

- [ ] **Step 3: Typecheck + full test.**

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/components/guac-params-fields.tsx
git commit -m "feat(gateway): RDP security selector on the resource form"
```

---

## Deploy (SEPARATE — needs explicit approval)

- Manager (form/params) + data-plane (buildConnect). No schema/`db push`, no connector/kasm.
- Tag; bump prod manager + data-plane (+ migrate for tag discipline). Data-plane restart drops live sessions.
- Smoke: `/login` 200; set the failing RDP resource's security to **NLA**, connect → session opens (no "wrong security type").
- English user-facing release note.

## Self-Review

- **Coverage:** field/parse/resolve/emit + tests (T1), buildConnect default-any override (T2), form selector + mapping (T3). All spec sections mapped.
- **Consistency:** `rdpSecurity` name identical across GuacParams / GuacFields / `c.Params["security"]` key; curated set `any/nla/tls/rdp` identical in parse (T1) and the select options (T3, "" = Automatic = any).
- **Default-safe:** unset → `toGuacArgs` omits `security` → buildConnect emits `any` (today's behaviour); no migration.
