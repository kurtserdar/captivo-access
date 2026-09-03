# Policy-level clipboard default — design spec

**Date:** 2026-09-03
**Status:** Approved for planning
**Slice:** Add a tenant-wide (policy-level) default for the per-resource clipboard control, mirroring the existing `watermarkDefault` pattern.

## Goal

Let an admin set one org-wide default clipboard policy that new and
un-overridden resources inherit, so clipboard (a data-exfiltration/DLP vector)
can be locked down centrally instead of per-resource. A resource may still
override the default explicitly.

## Background — current state

Clipboard is already implemented and enforced server-side for both non-webapp
access methods, driven by a single per-resource field:

- `Site.clipboardMode String @default("allow")` — values `allow | no_copy | no_paste | none`.
- **GATEWAY (guacd RDP/SSH/VNC):** `toGuacArgs()` (`src/lib/gateway/guac-params.ts:92-93`)
  emits `disable-copy` / `disable-paste` only for restrictive modes; `allow`
  emits nothing → guacd upstream default (enabled).
- **ISOLATED (KasmVNC):** `clipboardToKasm()` (`dataplane/kasmtunnel.go:123`) maps
  the mode to Xvnc `-SendCutText` / `-AcceptCutText` (always set explicitly).
- **TRANSPARENT (web):** resolved in `src/app/api/internal/site/by-host/route.ts:36`
  and injected by `dataplane/browserproxy.go` (`clipboardScript`). GATEWAY is
  forced to `"allow"` there because gateway clipboard is handled via guacd, not
  the web proxy.

There is **no policy-level default**. The only "default" is the column default
`"allow"`. Contrast with the **watermark** control, which already has both a
per-resource override (`Site.watermark Boolean?`, `null = inherit`) and a global
default (`PlatformSettings.watermarkDefault Boolean?`), resolved via
`resolvedWatermarkDefault()` and consumed as `site.watermark ?? (await resolvedWatermarkDefault())`
(`src/app/api/internal/gateway/descriptor/route.ts:41`). This slice makes
clipboard follow the same shape.

## Core invariant

Inheritance is resolved **entirely server-side**. The sentinel value (`null` /
`"inherit"`) is **never** sent to the data-plane or the browser: every consumer
resolves `site.clipboardMode ?? resolvedClipboardDefault()` to a concrete
`allow | no_copy | no_paste | none` before emitting it. Consequently the
data-plane (`kasmtunnel.go`, `browserproxy.go`) and all client code
(`clipboard-caps.ts`, gateway/isolated session clients) are **unchanged**.

## Design

### 1. Data model

- Change `Site.clipboardMode` from `String @default("allow")` to **`String?`**
  (drop the `@default`). Semantics: `null = inherit the global clipboardDefault`.
  Comment updated to say so.
- Add `PlatformSettings.clipboardDefault String?` — `null = "allow"` (behavior
  preserved). Mirrors `watermarkDefault`.

Both ship via `prisma db push` (this repo has no migration files; the migrate
image runs `db push`).

### 2. Resolution helper

Add to `src/lib/settings/platform.ts`, mirroring `resolvedWatermarkDefault()`:

```ts
const CLIPBOARD_MODES = ["allow", "no_copy", "no_paste", "none"];

// Tenant-wide clipboard default for resources that inherit (Site.clipboardMode
// is null). DB value if valid, else "allow". No env fallback (UI-only control).
export async function resolvedClipboardDefault(): Promise<string> {
  const s = await getPlatformSettings();
  const v = s.clipboardDefault;
  return v && CLIPBOARD_MODES.includes(v) ? v : "allow";
}
```

Also extend the `PlatformSettings` interface, the `EMPTY` constant, and the
`getPlatformSettings()` mapping with `clipboardDefault: c?.clipboardDefault ?? null`.
`savePlatformSettings()` needs no change (it spreads `...input`).

### 3. Consumers — resolve inherit at every read site

Three server-side read points must resolve the sentinel:

1. **Gateway descriptor** — `src/app/api/internal/gateway/descriptor/route.ts:66`:
   `toGuacArgs(resolved, site.clipboardMode ?? (await resolvedClipboardDefault()), …)`.
2. **Isolated descriptor** — same file, line 54:
   `clipboardMode: site.clipboardMode ?? (await resolvedClipboardDefault())`.
   (Resolve once into a local and use it in both branches.)
3. **Web by-host** — `src/app/api/internal/site/by-host/route.ts:36`. Keep the
   existing GATEWAY→`"allow"` shortcut; for the non-gateway case resolve:
   `site.accessMode === "GATEWAY" ? "allow" : (site.clipboardMode ?? (await resolvedClipboardDefault()))`.

No other consumer reads `clipboardMode` for enforcement. `clipboard-caps.ts`,
`browserproxy.go`, and `kasmtunnel.go` receive an already-resolved concrete mode
and stay as-is.

### 4. Data migration (deploy step)

`db push` syncs schema only. Existing rows all carry the explicit default
`"allow"`; per the approved decision they move to inherit so they follow the new
policy default. One-off, idempotent SQL run at deploy against prod:

```sql
UPDATE "Site" SET "clipboardMode" = NULL WHERE "clipboardMode" = 'allow';
```

Behavior-preserving at ship because `clipboardDefault` resolves to `"allow"`.
Documented as an explicit deploy task, not a code migration.

### 5. Write path

- `src/lib/site/validate.ts` (lines ~74-80, ~124-136): accept `"inherit"` and
  map it to **`null`**; an invalid/absent value also maps to `null` (inherit) —
  the safe, policy-following choice. Valid concrete values pass through. The
  validated shape's `clipboardMode` type becomes `string | null`.
- Site create/update routes (`src/app/api/admin/sites/route.ts`,
  `src/app/api/admin/sites/[id]/route.ts`) already write `clipboardMode: v.clipboardMode`
  — they carry `null` through unchanged once validate emits it.

### 6. Admin UI

- **Resource form** (`src/app/(app)/admin/sites/site-form.tsx`): the three
  `clipboardMode` dropdowns (ISOLATED ~316-322, GATEWAY ~377-384, TRANSPARENT
  ~449-456) gain a first option **`Inherit (policy default)`** with value
  `"inherit"`. Form state maps `null → "inherit"` on load; new resources default
  to `"inherit"`. The GATEWAY hint keeps its "enforced by guacd" wording.
- **Policy form** (`src/app/(app)/admin/policy/platform-settings-form.tsx`): add
  a clipboard-default `<select>` near the watermark default, with the four
  **concrete** options only (no "inherit"). Its value feeds `clipboardDefault`
  in the settings POST payload. The policy save route that calls
  `savePlatformSettings` includes `clipboardDefault` in the parsed input
  (validated against `CLIPBOARD_MODES`, else `null`).

### 7. Copy / wording

English-only. Resource dropdown label: `Inherit (policy default)`. Policy field
label e.g. `Default clipboard policy` with a hint that per-resource settings
override it and that `Allow` preserves current behavior.

## Files touched

- `prisma/schema.prisma` — `Site.clipboardMode` → `String?`; add `PlatformSettings.clipboardDefault String?`.
- `src/lib/settings/platform.ts` — interface + EMPTY + mapping + `resolvedClipboardDefault()` + `CLIPBOARD_MODES`.
- `src/app/api/internal/gateway/descriptor/route.ts` — resolve inherit (isolated + gateway branches).
- `src/app/api/internal/site/by-host/route.ts` — resolve inherit (non-gateway).
- `src/lib/site/validate.ts` — accept `"inherit"` → `null`; type `string | null`.
- `src/app/(app)/admin/sites/site-form.tsx` — `Inherit` option in 3 dropdowns; `null↔"inherit"` mapping; new-resource default `"inherit"`.
- `src/app/(app)/admin/policy/platform-settings-form.tsx` — clipboard-default select.
- Policy settings POST route — parse/validate `clipboardDefault`.
- Tests (below).
- Deploy: `db push` + the one-off `UPDATE` SQL.

## Testing

- `resolvedClipboardDefault`: null → `"allow"`; each valid value → itself; invalid → `"allow"`.
- Descriptor resolution: `site.clipboardMode = null` + `clipboardDefault = "no_paste"` → effective `"no_paste"`; `site.clipboardMode = "allow"` (explicit override) + default `"none"` → effective `"allow"`.
- `validate.ts`: `"inherit"` → `null`; `"no_copy"` → `"no_copy"`; garbage → `null`.
- Regression: existing `guac-params` / `clipboard-caps` / `clipboardToKasm` tests still pass unchanged (they only ever see concrete modes).

## Out of scope

- No change to how clipboard is *enforced* (guacd params, Xvnc flags, web
  injection) — only where the mode is *resolved* from.
- No env-var fallback for `clipboardDefault` (UI-only, like `maxGrantDays`).
- No `clipboard-encoding` or other new guacd params.
- Web/transparent clipboard behavior itself is untouched; the web path only
  gains sentinel resolution because the field is shared.

## Global constraints

- **English-only** for all captivo-access code, comments, console, and UI copy.
- **No Claude signature** in commits/PRs.
- **Deploy needs explicit user approval**; the data-migration SQL runs only as
  part of an approved deploy.
- Schema ships via `prisma db push` (no migration files).
- Every release tag gets an English, user-facing `gh release edit` note.
