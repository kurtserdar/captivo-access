# Global Keystroke Logging Policy — Design

**Date:** 2026-08-20
**Status:** Approved (design), pending implementation
**Related:** keystroke timeline slice (v0.88.0), `docs/superpowers/specs/2026-08-20-keystroke-timeline-design.md`

## Problem

Keystroke logging (the SSH/RDP typed-input timeline shipped in v0.88.0) is
opt-in per Resource only: `Site.keystrokeLogging`. There is no tenant-wide
control. An operator who wants keystroke logging governed centrally — either
disabled everywhere, or *mandated* on every recorded session for compliance —
has to visit each Resource one by one, and nothing stops a Resource owner from
turning it back off.

This mirrors a gap other governance controls already closed by moving to the
`/admin/policy` settings layer (`recordingConsentRequired`, `watermarkDefault`,
`maxGrantDays`, audit/recording retention, etc.).

## Goals

- One tenant-wide setting at `/admin/policy` that governs keystroke logging.
- Support a **compliance "required" mode**: forced on for every recorded
  gateway session, not overridable per Resource.
- Preserve each Resource's stored intent so switching the policy back to
  per-resource restores prior per-Resource choices.
- Follow the existing PlatformSettings DB→(env→)default pattern exactly.

## Non-goals

- No change to *how* keystrokes are captured, encrypted, stored, or displayed
  (the v0.88.0 pipeline is unchanged).
- Keystroke logging does **not** force session recording on. It remains an
  adjunct to recording (the timeline seeks the recording; with no recording
  there is nothing to seek). "Required" applies only where recording is on.
- No env-var fallback for the new setting (UI-only control, like
  `maxGrantDays` / `vendorIpAllowlist`).

## Design

### Three-state governance switch

A single policy setting `keystrokeLoggingMode` with three values:

| Mode | Meaning | Effective per session |
|---|---|---|
| `off` | Feature disabled tenant-wide | Always off; per-Resource toggle hidden/ignored |
| `per_resource` (default) | Each Resource decides (today's behavior) | Uses `Site.keystrokeLogging` |
| `required` | Compliance mode — mandated | Forced on for every **recorded** gateway session; Resource cannot disable |

### Storage

Add to the `PlatformSettings` singleton:

```prisma
keystrokeLoggingMode String?  // "off" | "per_resource" | "required"; null → per_resource
```

`Site.keystrokeLogging` (boolean) is **unchanged** — the stored per-Resource
intent survives policy changes. No per-Site schema change.

### Resolver (`src/lib/settings/platform.ts`)

- Add `keystrokeLoggingMode: string | null` to the `PlatformSettings`
  interface, `EMPTY`, `getPlatformSettings` mapping, and `savePlatformSettings`
  (the spread already carries it once it is in the interface).
- New resolver, mirroring `resolvedDefaultConnectorLogLevel`'s allowlist shape:

```ts
export type KeystrokeMode = "off" | "per_resource" | "required";
const KEYSTROKE_MODES: KeystrokeMode[] = ["off", "per_resource", "required"];

export async function resolvedKeystrokeLoggingMode(): Promise<KeystrokeMode> {
  const s = await getPlatformSettings();
  const v = s.keystrokeLoggingMode;
  return v && (KEYSTROKE_MODES as string[]).includes(v) ? (v as KeystrokeMode) : "per_resource";
}
```

### Effective computation — pure helper (`src/lib/keystroke/policy.ts`)

Extract the effective decision into a pure, unit-testable function so the
descriptor route stays thin:

```ts
import type { KeystrokeMode } from "@/lib/settings/platform";

export function effectiveKeystrokeLogging(input: {
  mode: KeystrokeMode;
  recordingEnabled: boolean; // global RECORDING_ENABLED gate
  recordSessions: boolean;   // Site.recordSessions
  siteFlag: boolean;         // Site.keystrokeLogging
}): boolean {
  // Keystroke logging is an adjunct to recording: without a recording there is
  // nothing for the timeline to seek to. Everything is gated on recording being
  // active for this session — including "required".
  const base = input.recordingEnabled && input.recordSessions;
  if (!base) return false;
  switch (input.mode) {
    case "off": return false;
    case "required": return true;
    case "per_resource": return input.siteFlag;
  }
}
```

### Descriptor wiring (`src/app/api/internal/gateway/descriptor/route.ts`)

Currently returns:

```ts
keystrokeLogging: recordingEnabled() && site.recordSessions && site.keystrokeLogging
```

Replace with:

```ts
keystrokeLogging: effectiveKeystrokeLogging({
  mode: await resolvedKeystrokeLoggingMode(),
  recordingEnabled: recordingEnabled(),
  recordSessions: site.recordSessions,
  siteFlag: site.keystrokeLogging,
})
```

No data-plane change — the descriptor's boolean already drives the observer.

### Policy form UI (`src/app/(app)/admin/policy/`)

- `platform-settings-form.tsx`: add a control for `keystrokeLoggingMode` — a
  three-option selector (segmented control or `<select>`, matching the form's
  existing controls) with helper copy:
  - Off — "Keystroke logging is disabled for all resources."
  - Per resource (default) — "Each resource decides in its own settings."
  - Required — "Force keystroke logging on for every session that is recorded.
    Resources cannot turn it off."
  - A one-line note under the control: *"Applies to sessions where recording is
    enabled."*
- `src/app/api/admin/policy/platform/route.ts`: parse and persist
  `keystrokeLoggingMode`, validating against the allowlist (invalid → store
  `per_resource` or leave null → resolver defaults).
- The page loader passes the current value into the form (same as the other
  platform settings).

### Site form UI (`src/app/(app)/admin/sites/`)

The per-Resource keystroke checkbox reflects the global mode. The server page
(`[id]/edit/page.tsx` and the create page) resolves the mode and passes it as a
prop to `site-form.tsx`:

- `per_resource` → normal editable checkbox (today's behavior).
- `off` → checkbox hidden, replaced by a muted note: *"Keystroke logging is
  disabled in Policy."*
- `required` → checkbox shown checked and disabled, with a note: *"Required by
  Policy — keystroke logging is on for all recorded sessions."*

The stored `Site.keystrokeLogging` value is still submitted/persisted normally
under `per_resource`; under `off`/`required` the control is non-editable but the
stored value is left untouched (so intent is preserved).

## Testing

Unit tests for the pure helper (`src/lib/keystroke/policy.test.ts`) — the truth
table:

- `recordingEnabled=false` → false in all modes.
- `recordSessions=false` → false in all modes.
- `mode=off` → false even when `siteFlag=true`.
- `mode=required` → true regardless of `siteFlag`.
- `mode=per_resource` → equals `siteFlag`.

Resolver test (extend `src/lib/settings/*` test style if present, else a small
`platform` resolver test): unknown/empty value → `per_resource`; each valid
value round-trips.

No route-handler tests (repo convention: routes are not unit-tested; the
descriptor change is covered by the helper test + build).

## Rollout

- Prisma `db push` adds the nullable `keystrokeLoggingMode` column (additive,
  non-destructive — safe for the migrate image at the release tag).
- Default behavior is unchanged (null → `per_resource`), so existing
  deployments keep today's per-Resource semantics until an admin opts in.
- Ship as its own release tag (proposed v0.89.0), manager-only change plus the
  additive schema column (bump manager + migrate; data-plane unchanged but
  bumped to keep the release-tag discipline is optional — no data-plane code
  changed).
- English user-facing release note.

## Privacy note

Keystroke logging captures typed content. `required` is a strong surveillance
posture; it pairs naturally with the existing consent gate
(`recordingConsentRequired`). Password masking after `sudo`/`su`/`passwd`
remains in effect. This is called out in the policy helper copy but no new
enforcement is added here.
