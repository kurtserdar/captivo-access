# Policy-level Recording Mode — Design Spec

**Date:** 2026-09-08
**Status:** Approved for planning (model A — mandate with a hard floor).
**Applies to:** both editions (self-host + multi-tenant). Default preserves current
behavior, so self-host is byte-behavior-identical until an admin opts in.

## Goal

Add a tenant-wide **recording policy** on `/admin/policy` that governs whether the
per-resource "record sessions" toggle is honored, forced on, or forced off —
mirroring the existing `keystrokeLoggingMode` policy exactly. Today recording is
gated only by the global capability (`RECORDING_ENABLED`) plus each resource's own
`recordSessions` toggle; there is no tenant-level policy in between, so an admin
cannot mandate "record every session" for compliance.

## Model (approved: A — mandate)

A new tenant policy `recordingMode` with three values:

| Mode | Effect on a resource's effective recording |
|---|---|
| `off` | Recording disabled tenant-wide — per-resource toggles are ignored. |
| `per_resource` (**default**) | Today's behavior — the resource's own `recordSessions` toggle decides. |
| `required` | Every resource is recorded — a resource **cannot** opt out (hard floor). |

**Override direction is a mandate, not a free override:** policy sets the floor,
a resource may not go below it. `required` wins over a resource's "off";
`per_resource` lets the resource choose. This avoids the compliance hole where a
"record everything" mandate is silently undone per-resource.

**The global capability stays master.** `RECORDING_ENABLED` (operator/env) gates the
whole feature: with it off, even `required` records nothing. Effective recording is
always `recordingEnabled() && effectiveRecord(mode, site.recordSessions)`.

**Runtime override, not stored mutation.** Policy is applied when the effective flag
is *resolved per request*, never by mutating the stored per-resource `recordSessions`.
So a resource keeps its own saved preference; if policy later returns to
`per_resource`, that preference takes effect again. (Consistent with how
`recordSessions` is already re-read every request so a change takes effect immediately.)

## Design

### 1. Data model (additive schema change)

`PlatformSettings` gains one nullable column, mirroring `keystrokeLoggingMode`:

```prisma
recordingMode String? // null = env/default → "per_resource"; one of off|per_resource|required
```

Additive + nullable → safe for both editions; existing rows (null) resolve to
`per_resource` = today's behavior. **Staging-tested against a prod copy before prod**
(standing constraint for schema changes).

### 2. Settings plumbing (`src/lib/settings/platform.ts`)

Mirror the `keystrokeLoggingMode` members exactly:
- Add `recordingMode: string | null` to the `PlatformSettings` type, to `EMPTY`, and to
  the `getPlatformSettings()` mapping.
- Add a resolver mirroring `resolvedKeystrokeLoggingMode()`:

```ts
export const RECORDING_MODES = ["off", "per_resource", "required"] as const;
export async function resolvedRecordingMode(): Promise<string> {
  const s = await getPlatformSettings();
  if (s.recordingMode && RECORDING_MODES.includes(s.recordingMode as never)) return s.recordingMode;
  const v = process.env.RECORDING_MODE?.trim().toLowerCase();
  if (v && RECORDING_MODES.includes(v as never)) return v;
  return "per_resource";
}
```

### 3. The effective-record helper (`src/lib/recording/mode.ts`, pure + unit-tested)

```ts
// Applies the tenant recording policy to a resource's own toggle. The global
// RECORDING_ENABLED capability is applied separately by the caller.
export function effectiveRecordSessions(mode: string, siteToggle: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "required") return true;
  return siteToggle; // "per_resource" (and any unknown value → safe default)
}
```

### 4. Application points (the only two places that compute effective recording)

Both currently compute `recordingEnabled() && site.recordSessions`; both become
`recordingEnabled() && effectiveRecordSessions(await resolvedRecordingMode(), site.recordSessions)`:

- **`src/app/api/internal/site/by-host/route.ts`** (line ~35) — TRANSPARENT web-app
  recording (the injected DOM recorder path).
- **`src/app/api/internal/gateway/descriptor/route.ts`** (lines ~65, ~88) —
  GATEWAY/ISOLATED (guac) recording. This route already awaits
  `resolvedKeystrokeLoggingMode()`, so adding `resolvedRecordingMode()` is consistent
  and adds no new round-trip pattern (both read the 30s-cached platform settings).

No change to `validateSiteInput` — the per-resource toggle is still saved as the
resource's own preference; the policy is applied at resolution time, not at save time.

### 5. Policy API (`src/app/api/admin/policy/platform/route.ts`)

Accept + validate `recordingMode`, mirroring the `keystrokeLoggingMode` line:

```ts
recordingMode: ["off", "per_resource", "required"].includes(body.recordingMode)
  ? (body.recordingMode as string) : null,
```

(Saving already emits an audit admin action for platform-settings updates — unchanged.)

### 6. UI

- **`/admin/policy` (`PlatformSettingsForm`)** — add a `recordingMode` select
  (Off / Per resource / Required), rendered next to the recording-consent and
  keystroke-logging controls, with one line of help text per option. The policy page
  already fetches platform settings and passes them in.
- **Resource form (`src/app/(app)/admin/sites/site-form.tsx`)** — when the effective
  policy is not `per_resource`, the "record sessions" toggle must not mislead: render it
  **disabled**, reflecting the forced state (`required` → shown on + locked; `off` →
  shown off + locked) with a short "Managed by policy" note. The current recordingMode is
  passed to the form as a prop, resolved server-side by the pages that render the form
  (new + edit). In `per_resource` mode the toggle behaves exactly as today.

### 7. Consent + keystroke interactions (boundaries)

- **Consent** (`recordingConsentRequired`) already keys off the effective recording
  flag, so under `required` the consent gate simply applies to more sessions — no
  special handling.
- **Keystroke logging** keeps its own independent `keystrokeLoggingMode` policy;
  `recordingMode` governs **session recording only** and does not enable keystroke
  logging. (Keystroke logging remains gated by its own policy + per-resource flag.)

## Testing

- **Unit:** `effectiveRecordSessions` truth table (off/per_resource/required ×
  toggle true/false); `resolvedRecordingMode` precedence (DB → env `RECORDING_MODE` →
  default `per_resource`, invalid values rejected).
- **Integration (both edition modes):** `by-host` and `gateway/descriptor` return the
  correct effective `record` for each policy mode (e.g. `required` forces record on a
  resource whose toggle is off; `off` suppresses a resource whose toggle is on;
  `per_resource` equals the toggle); capability `RECORDING_ENABLED=off` overrides all
  modes to false. Reuse the multi-tenant integration harness.
- **Policy API:** valid modes persist; invalid → null (default). Cross-tenant: a mode set
  for tenant A does not affect tenant B.
- **Regression:** full suite + build green with `MULTI_TENANT` off; default (`per_resource`,
  null column) reproduces today's behavior byte-for-byte.

## Rollout

Additive migration (staging-tested against a prod copy) → release (next minor,
lockstep) → SaaS redeploy. Default `per_resource` means the release is behavior-neutral
until an admin sets a mode. No connector change.

## Risks / notes

- **Compliance clarity:** `required` is a hard floor by design; document in the help text
  that resources cannot opt out under `required`.
- **Stale in-flight sessions:** effective recording is re-resolved per request (same as
  `recordSessions` today), so a policy change takes effect on the next request without a
  restart; an already-streaming session is not retroactively altered — acceptable and
  consistent with current behavior.
- **UI honesty:** the resource-form lock is required, not optional — without it the toggle
  would silently disagree with policy.

## Global constraints

- English only in the repo (code, comments, console/UI); no Claude attribution in
  commits/PRs; proper Turkish only in user-facing chat.
- `MULTI_TENANT` off ⇒ self-host byte-behavior preserving (default `per_resource`).
- Schema change staging-tested against a prod copy before prod.
- Deploy + release-note steps are separate standing gates requiring explicit user approval.
