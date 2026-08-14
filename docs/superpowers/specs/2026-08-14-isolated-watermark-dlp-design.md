# Isolated Watermark DLP — Design

**Date:** 2026-08-14
**Status:** Approved (design)

## Goal

Overlay an identifying watermark (vendor email + live clock) across an isolated
browser session so the vendor's live screen — and any screenshot or photo of it —
carries who was viewing and when: a data-loss-prevention deterrent for sensitive
vendor access. Configurable as a global default with a per-site override.

## Scope

Watermark only (live-view / client-layer — see Enforcement). `DLP_Region` (black out outside a rectangle) is **not** included: the
isolated session is a full-screen kiosk Chromium, so there is nothing meaningful to
region-restrict. GATEWAY uses guacd (no KasmVNC DLP) and is out of scope.

## Enforcement (verified)

KasmVNC's Xvnc accepts DLP watermark as CLI parameters (same pattern as the B2
clipboard flags — we launch Xvnc directly, bypassing the yaml wrapper). Verified:
`DLP_WatermarkText` supports **strftime** formatting, so `"<email>  %Y-%m-%d %H:%M
UTC"` renders a live clock.

**Where it appears (spike-corrected):** KasmVNC composites the watermark at the
**RFB/client-delivery layer**, not into the X11 framebuffer — deliberately, so it
cannot be stripped server-side. A spike x11grab capture showed NO watermark. So the
watermark appears to every VNC client — the **vendor's browser**, the **admin live
view** (`/kasm-view`), and therefore any **screenshot/photo** the vendor takes — which
is exactly the DLP goal (deter + attribute leaks on the viewer's live screen). It does
**NOT** appear in our session recording, because the recording uses x11grab (the raw
framebuffer). That is acceptable: the recording is an internal audit artifact that
already carries full who/when/what metadata; the watermark's purpose is the vendor's
live screen.

## Configuration

Mirrors the existing recording/clipboard settings:

- **Global default:** `PlatformSettings.watermarkDefault` (`boolean | null`) with a
  toggle on `/admin/policy`; `resolvedWatermarkDefault()` resolves DB → env
  (`WATERMARK_DEFAULT`) → default `false`.
- **Per-site override:** `Site.watermark` (`Boolean?`, null = inherit) with an
  Inherit / On / Off control on the site form.
- **Resolution:** `site.watermark ?? resolvedWatermarkDefault()`.
- Two additive (nullable) schema fields → `prisma db push` (non-destructive).

## Watermark content & appearance (fixed)

- **Text:** `"<vendor email>  %Y-%m-%d %H:%M UTC"` — identity + live clock. No
  per-deployment text/colour/angle configuration (fixed defaults keep it simple and
  consistent). Emails cannot contain `%`, so strftime never misinterprets the identity.
- **Appearance (fixed Xvnc flags):** tiled (`DLP_WatermarkRepeatSpace`), diagonal
  (`DLP_WatermarkTextAngle=30`), translucent white (`DLP_WatermarkTint=255,255,255,45`
  — the 4th value is alpha), `DLP_WatermarkFontSize=28`. Exact spacing tuned in the
  plan's spike against a real session.

## Global constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not break clipboard DLP, recording, live watching, terminate, sizing, or GATEWAY.
- Backward compatible: no watermark field / off → no DLP flags (today's behaviour).
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

## Architecture

Watermark on/off + text flows: descriptor (manager, resolves + builds text) →
`kasmDesc` (dataplane) → `POST /session` → broker Xvnc flags. This mirrors how
`clipboardMode` / `record` already flow.

### Schema (`prisma/schema.prisma`)

- `Site.watermark Boolean?` (null = inherit the global default).
- `PlatformConfig.watermarkDefault Boolean?` (the global default; wherever
  `recordingConsentRequired` etc. live).

### Manager

- **`lib/settings/platform.ts`:** add `watermarkDefault: boolean | null` to
  `PlatformSettings` (load/default), and `resolvedWatermarkDefault(): Promise<boolean>`
  (DB → env `WATERMARK_DEFAULT` → `false`), matching `resolvedRecordingConsentRequired`.
- **Descriptor `route.ts`:** add `watermark` to the site select; resolve
  `on = site.watermark ?? (await resolvedWatermarkDefault())`. When on, fetch the
  vendor's email (`db.user.findUnique({ where:{ id:userId }, select:{ email:true } })`)
  and set `watermarkText = "${email}  %Y-%m-%d %H:%M UTC"`; else `""`. Add
  `watermarkText` to the kasm descriptor JSON.
- **`/admin/policy` (platform-settings-form):** a "Screen watermark" default toggle,
  wired through the platform-settings save like the other booleans. Hint notes it
  applies to Isolated Browser sessions.
- **Site form + create/update routes + `[id]/edit`:** a per-site "Watermark"
  Inherit/On/Off control writing `Site.watermark` (null/true/false); thread it through
  `site-form.tsx`, `validate.ts`, the sites POST/PUT routes, and the edit page select
  (following how `recordSessions`/`clipboardMode` are handled).

### Data-plane (`kasmtunnel.go`)

- `kasmDesc`: add `WatermarkText string` (json `watermarkText`).
- `openKasmSession(..., watermarkText string)`: include `"watermarkText"` in the
  `POST /session` body (JSON-quoted).
- Pass `d.WatermarkText` at the call site.

### Broker (`kasm-browser/control.py`)

- `POST /session`: read `watermarkText` (string, default `""`).
- `open_session(..., watermark_text="")` → `_spawn(..., watermark_text="")`: when
  non-empty, append to the Xvnc argument list:
  `-DLP_WatermarkText=<text>`, `-DLP_WatermarkTextAngle=30`,
  `-DLP_WatermarkRepeatSpace=<n>`, `-DLP_WatermarkFontSize=28`,
  `-DLP_WatermarkTint=255,255,255,45`. Empty text → no flags (unchanged). Keep the
  text length-bounded (e.g., ≤200 chars) defensively.

## Data flow

1. Vendor opens an isolated session → descriptor resolves watermark on (site override
   or global default) → builds `"<email>  %Y-%m-%d %H:%M UTC"`.
2. Dataplane threads `watermarkText` → broker starts Xvnc with the DLP watermark flags.
3. The vendor sees a tiled, diagonal, translucent watermark with their email + live
   clock; the admin live view (another VNC client) shows it too. It is NOT in the
   x11grab recording (RFB-layer composite).
4. Watermark off (site off, or global default off and site inherits) → no flags,
   clean screen (today's behaviour).

## Error handling

- Missing/empty `watermarkText` (off, old client) → no DLP flags → normal session.
- User email lookup fails → treat as off (no text) rather than blocking the session.
- Over-long text → truncated (broker bound).

## Testing

- Spike (in the plan): run a kasm container session with the DLP watermark flags and
  confirm the watermark renders (tiled/diagonal/translucent) and the `%H:%M` clock
  updates; tune `RepeatSpace`.
- `go build ./...` + `go test ./...`; `pnpm build`; `python3 ast.parse` on control.py.
- `prisma db push` (additive, non-destructive) applies the two columns.
- Manual Gate after deploy: turn on the global default (or a site override) → an
  isolated session's browser shows the email + live-time watermark, and the admin
  live view shows it; turning it off → clean screen. (The recording will NOT carry the
  watermark — expected.) Clipboard DLP + sizing + GATEWAY unchanged.

## Deploy

- Ships in `kasm-browser` + `dataplane` + `manager` images (gateway host pulls the new
  kasm image for the flags).
- Schema: additive `prisma db push` (no `--accept-data-loss`).
- Version bump + English `gh release edit` note. Deploy is a separate gate — do not
  auto-run.
