# Self-host Capabilities On By Default — Design Spec

**Date:** 2026-09-08
**Status:** Approved for planning.
**Scope:** Flip the four Pro capability env gates from opt-in to opt-out so a fresh
self-host install ships with the full product working, no manual flag-hunting.
`MULTI_TENANT` stays opt-in.

## Problem

The four Pro capability gates default OFF and only turn on when their env var is
explicitly set to `1`/`true`/`on`. So a self-host installer has to discover and
enable each one to unlock core value (remote-desktop gateway, isolated browser,
recording, credential vault). This is poor UX — the ready package should come with
everything on. (This same gap is why the SaaS deployment showed only the "Web app"
resource type until the flags were set.)

## Goal

A self-host install with a minimal `.env` (nothing set) gets all four capabilities
**on** out of the box; an operator can still explicitly disable any of them with
`=0`/`false`/`off`. `MULTI_TENANT` must remain **off** by default (it is the
deployment-mode switch; defaulting it on would turn every install into multi-tenant
mode).

## Classification (approved)

**Flip to default-ON (opt-out) — Pro capability feature-unlock gates:**
- `NATIVE_GATEWAY` (`src/lib/gateway/native.ts`) — "Remote session (RDP/SSH/VNC)" type.
- `ISOLATED_ENABLED` (`src/lib/isolation/enabled.ts`) — "Isolated browser" type.
- `VAULT_ENABLED` (`src/lib/vault/enabled.ts`) — credential vault; required for remote-session logins.
- `RECORDING_ENABLED` (`src/lib/recording/enabled.ts`) — session-recording capability.

**Stays opt-in (default OFF) — must NOT flip:**
- `MULTI_TENANT` (`src/lib/tenant/enabled.ts`) — SaaS/self-host mode switch; default off = self-host is fundamental.

**Out of scope (policy defaults / config-dependent, not feature-unlock gates — unchanged):**
- `RECORDING_CONSENT_REQUIRED`, `WATERMARK_DEFAULT` — policy defaults resolved via
  platform settings (DB → env → their own default); not capability unlocks.
- `RECORDING_MODE` — the recording policy (default `per_resource`); unchanged.
- `externalAnchorEnabled` (DB setting) — RFC 3161 external anchoring needs a TSA URL
  configured; cannot be on without config, so it correctly stays off until set up.
- Non-boolean config (URLs, domains, timeouts, RP id) — not gates.

## Design

### 1. Shared flag helper (`src/lib/env-flag.ts`)

A single parser makes the default explicit and removes the duplicated inline logic:

```ts
// Parse a boolean capability env var with an explicit default when unset/unknown.
// On:  "1" | "true" | "on" | "yes"   Off: "0" | "false" | "off" | "no"
// Anything else (unset, empty, unrecognized) → defaultValue.
export function flagOn(raw: string | undefined, defaultValue: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return defaultValue;
}
```

### 2. Re-point the gate functions

Each gate keeps its name/signature; only its body changes to route through `flagOn`
with the classified default:

```ts
// src/lib/gateway/native.ts
export function nativeGatewayEnabled(): boolean { return flagOn(process.env.NATIVE_GATEWAY, true); }
// src/lib/isolation/enabled.ts
export function isolationEnabled(): boolean { return flagOn(process.env.ISOLATED_ENABLED, true); }
// src/lib/vault/enabled.ts
export function vaultEnabled(): boolean { return flagOn(process.env.VAULT_ENABLED, true); }
// src/lib/recording/enabled.ts
export function recordingEnabled(): boolean { return flagOn(process.env.RECORDING_ENABLED, true); }
// src/lib/tenant/enabled.ts — UNCHANGED default (off); routed through the helper for consistency
export function multiTenantEnabled(): boolean { return flagOn(process.env.MULTI_TENANT, false); }
```

(Confirm the exact exported function name for the vault gate before editing — use whatever `src/lib/vault/enabled.ts` already exports.)

### 3. Deploy artifacts / docs

- `deploy/.env.prod.example` — change the four flags from commented "off by default;
  set to 1 to enable" to documented **on by default**, e.g. a commented
  `# NATIVE_GATEWAY=0  # remote-desktop gateway (on by default; set 0 to disable)`,
  and the same for the other three. `MULTI_TENANT` guidance unchanged (off).
- The self-host compose comments (`deploy/docker-compose.prod.yml`) that describe
  these flags — update "Off by default; set to 1 …" to "On by default; set to 0 to
  disable."
- SaaS (`deploy-saas/.env`) already sets all four `=1` explicitly — unaffected and
  left as-is (explicit is fine; the defaults now agree).

### 4. Deliberate default change (not byte-identical)

This intentionally changes the self-host default behavior: on upgrade, an existing
install with these flags unset gains the four capabilities. That is safe — they are
option/capability gates, not automatic actions:
- Gateway/Isolated only add resource *types* to the form.
- Vault only enables credential storage (used only when a remote-session resource is
  configured).
- Recording only makes the per-resource "record sessions" toggle effective; nothing
  is recorded until a resource opts in (and the `recordingMode` policy still applies).

The prior "self-host byte-identical" constraint governed incidental changes; this is a
deliberate, approved product-default change.

## Testing

- **Unit — `flagOn`:** on-tokens → true, off-tokens → false, unset/empty/unknown →
  the passed default (both true and false defaults exercised).
- **Unit — each gate:** unset → its classified default (the four Pro gates → true,
  `multiTenantEnabled` → false); explicit `0`/`off`/`false` → false; explicit
  `1`/`on`/`true` → true. Update the existing gate tests (which currently assert the
  old opt-in default) to the new semantics.
- **Regression:** full suite green. Note any test that implicitly relied on a gate
  being off-by-default in a non-multi-tenant context and fix it to set the env
  explicitly. `MULTI_TENANT` default-off behavior must be provably unchanged (the
  whole self-host test path depends on it).
- Build/typecheck green.

## Rollout

Release (next minor, lockstep). Self-host installs then ship capabilities on by
default. SaaS unaffected (explicit env). No schema change, no connector change,
no data migration.

## Risks / notes

- **`MULTI_TENANT` safety:** the single most important invariant — it must stay
  default-off. The plan's gate test asserts `multiTenantEnabled()` is false when
  unset. Any accidental flip is catastrophic (every self-host install would enter
  multi-tenant mode).
- **Test fallout:** some existing unit/integration tests may assume a gate is off
  unless set; flipping defaults can surface such assumptions. Fix by making those
  tests set the env explicitly, not by special-casing the gate.
- **VAULT + gateway coupling:** both now default on, so remote-session credentials
  work out of the box (gateway on without vault would be half-broken); the classification keeps them consistent.

## Global constraints

- English only in the repo (code, comments, console/UI); no Claude attribution in
  commits/PRs; proper Turkish only in user-facing chat.
- `MULTI_TENANT` off by default is preserved and test-guarded.
- Deploy + release-note steps are separate standing gates requiring explicit approval.
