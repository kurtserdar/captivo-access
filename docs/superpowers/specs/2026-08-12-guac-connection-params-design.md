# E1 — Guacamole connection parameters (remote-desktop resources)

**Status:** approved design (2026-08-12)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Scope:** first of two slices. E2 (file transfer / drive / SFTP) is a separate later spec.

## Goal

Let admins configure a **curated set of Guacamole connection parameters** for
remote-desktop (RDP/SSH/VNC) resources — as **global defaults on the Policy page**
and **per-resource overrides** on the resource form, where the resource value wins.
Parameters flow into the guacd handshake so a vendor's session honours them (e.g. a
Turkish-Q keyboard, lower colour depth, blocked clipboard).

## Curated parameter set

Stored/configured (policy default + per-resource override):

| Field | guacd arg | Protocol | Values |
|---|---|---|---|
| `serverLayout` | `server-layout` | RDP | keyboard-layout key (`tr-tr-qwerty`, `en-us-qwerty`, `de-de-qwertz`, `fr-fr-azerty`, `en-gb-qwerty`, `es-es-qwerty`, `it-it-qwerty`, `ja-jp-qwerty`, …) |
| `colorDepth` | `color-depth` | RDP/VNC | `8` \| `16` \| `24` |
| `enableWallpaper` | `enable-wallpaper` | RDP | boolean (emit `"true"` only when on; guacd default is off) |
| `enableTheming` | `enable-theming` | RDP | boolean |
| `enableFontSmoothing` | `enable-font-smoothing` | RDP | boolean |
| `enableFullWindowDrag` | `enable-full-window-drag` | RDP | boolean |

**Clipboard** is handled by **extending the existing `Site.clipboardMode`** (today
`allow`/`no_copy`/`no_paste`/`none`, applied to web resources only) to gateway
resources too — no new storage. Mapping into the handshake:
`no_copy` → `disable-copy=true`, `no_paste` → `disable-paste=true`, `none` → both.
(Its schema comment "(transparent only)" is updated.)

Out of scope for E1: file transfer (drive/SFTP), printing, audio, `resize-method`
(stays hardcoded `display-update`), RemoteApp, and the ~40 other guacd params.

## Storage & validation

- `VaultCredential.guacParams Json?` — per-resource overrides (gateway resources have a
  1:1 `VaultCredential`).
- `PlatformSettings.guacParamDefaults Json?` — global defaults.
- Both hold a `GuacParams` object. **The manager validates against the curated keys
  only** before persisting — unknown keys and out-of-range values are dropped, so no
  arbitrary guacd arg can be injected through this path (security).

## Components

### 1. Param model + resolver (`src/lib/gateway/guac-params.ts`, new — pure, unit-tested)

```ts
export interface GuacParams {
  serverLayout?: string;
  colorDepth?: 8 | 16 | 24;
  enableWallpaper?: boolean;
  enableTheming?: boolean;
  enableFontSmoothing?: boolean;
  enableFullWindowDrag?: boolean;
}

export const KEYBOARD_LAYOUTS: { value: string; label: string }[]; // curated list incl. "" = default

// Coerce untrusted JSON into a GuacParams keeping ONLY curated keys/valid values.
export function parseGuacParams(input: unknown): GuacParams;

// Per-field merge: resource value if present, else policy default. (undefined = guacd default.)
export function resolveGuacParams(resource: GuacParams, policy: GuacParams): GuacParams;

// Map resolved params + clipboardMode → guacd arg-name→value map (only set/true fields).
export function toGuacArgs(p: GuacParams, clipboardMode: string): Record<string, string>;
```

`toGuacArgs` emits: `server-layout` (if set), `color-depth` (if set), each `enable-*`
only when `true`, plus `disable-copy`/`disable-paste` from `clipboardMode`.

### 2. Settings accessor (`src/lib/settings/platform.ts`)

Add `resolvedGuacParamDefaults(): Promise<GuacParams>` — reads
`PlatformSettings.guacParamDefaults` and returns `parseGuacParams(...)`.

### 3. Descriptor route (`src/app/api/internal/gateway/descriptor/route.ts`)

- Add `clipboardMode` to the `site` select and `guacParams` to the vault fetch.
- Resolve: `const resolved = resolveGuacParams(parseGuacParams(cred.guacParams), await resolvedGuacParamDefaults());`
- Return a new field `params: toGuacArgs(resolved, site.clipboardMode)` (arg-name→value map).

### 4. Vault store (`src/lib/vault/store.ts`)

- `getVaultCredential` includes `guacParams` in its select (plaintext — not a secret).
- The create/update path (`setVaultCredential` or equivalent) persists a validated
  `guacParams` (via `parseGuacParams`) alongside the credential.

### 5. Data-plane handshake

- `dataplane/controlclient.go` — `GatewayDescriptor` gains `Params map[string]string
  \`json:"params"\``; `GuacConn` gains a `Params map[string]string` field, filled from it.
- `dataplane/guacproto.go` — `buildConnect`'s `default:` case consults the map:
  ```go
  default:
      if v, ok := c.Params[name]; ok {
          elems = append(elems, v)
      } else {
          elems = append(elems, "")
      }
  ```
  (The fixed cases — `hostname`/`port`/`username`/`password`/`private-key`/`ignore-cert`/
  `security`/`resize-method` — are unchanged. guacd only lists arg names valid for the
  selected protocol, so an irrelevant param is simply never emitted.)

### 6. UI — Policy page (`src/app/(app)/admin/policy/*` + `platform-settings-form.tsx`)

A new **"Remote-desktop defaults"** section: keyboard-layout `<select>`, colour-depth
`<select>` (Default / 24 / 16 / 8), and four RDP visual toggles. Saved into
`PlatformSettings.guacParamDefaults` (validated on the save route with `parseGuacParams`).

### 7. UI — Resource form (`src/app/(app)/admin/sites/site-form.tsx`)

On the gateway branch, a collapsible **"Advanced (Guacamole)"** section, **protocol-aware**:
- **RDP:** keyboard layout, colour depth, the four visual toggles.
- **VNC:** colour depth.
- **SSH:** none of the above (clipboard still applies).

Each field offers **"Use policy default"** (unset → falls back to the Policy value) vs an
explicit override. Clipboard stays the existing `clipboardMode` control (now effective for
gateway too). The create/update site route persists `guacParams` (validated).

## Data flow

Resource form / Policy → validated `GuacParams` JSON in `VaultCredential.guacParams` /
`PlatformSettings.guacParamDefaults`. On session start, the descriptor route resolves
`resource ?? policy` per field, maps to guacd arg names (+ clipboard), and returns them;
the data-plane injects them into the handshake via `buildConnect`.

## Error handling / edge cases

- **Unknown/invalid input** → `parseGuacParams` drops it (curated allowlist), so a bad
  value can never reach guacd.
- **Nothing set** → `params` is empty → guacd defaults (today's behaviour, unchanged).
- **Wrong-protocol param** (e.g. `server-layout` on a VNC resource) → guacd never lists
  that arg → never emitted. Harmless; the UI also hides it per protocol.
- **Migration** — two additive nullable JSON columns; `access-migrate` applies them
  automatically (no destructive change).

## Non-goals

- File transfer (drive/SFTP), printing, audio, RemoteApp, device redirection, `resize-method`
  configurability — E2 or later.
- No change to web-resource behaviour beyond clipboard already applying there.

## Testing

**TS (vitest, `src/lib/gateway/guac-params.test.ts`):**
- `parseGuacParams`: keeps curated keys, drops unknown, rejects out-of-range `colorDepth`,
  rejects a layout not in the allowlist, coerces booleans.
- `resolveGuacParams`: per-field resource-over-policy; unset stays unset.
- `toGuacArgs`: emits `server-layout`/`color-depth` when set; `enable-*` only when true;
  `clipboardMode` → `disable-copy`/`disable-paste`/both/none.

**Go (`dataplane/guacproto_test.go`):** `buildConnect` emits a `Params` value for a listed
arg name and empty for an unlisted one.

**Gate A (operator, after deploy):** set a Policy default (e.g. keyboard `tr-tr-qwerty`),
connect to an RDP resource → Turkish-Q layout active; override colour depth / a visual
toggle on one resource and confirm it wins; set clipboard to `none` on a gateway resource
and confirm copy/paste are blocked in-session.

## Deploy notes

- **Schema change** → bump **both** `access-manager` **and** `access-migrate` images and
  run migrate (per the deploy trap: a manager-only bump won't re-run the one-shot migrate).
  Manager + data-plane both change. English-only + GitHub Release note. Suggested **v0.28.0**.

## File map

**Schema:** `prisma/schema.prisma` (`VaultCredential.guacParams`, `PlatformSettings.guacParamDefaults`, clipboardMode comment).
**Create:** `src/lib/gateway/guac-params.ts` (+ `.test.ts`).
**Modify (manager):** `src/lib/settings/platform.ts`, `src/app/api/internal/gateway/descriptor/route.ts`,
`src/lib/vault/store.ts`, the site create/update route + `src/lib/site/validate.ts`,
the policy save route + `src/app/(app)/admin/policy/platform-settings-form.tsx`,
`src/app/(app)/admin/sites/site-form.tsx`.
**Modify (data-plane):** `dataplane/controlclient.go`, `dataplane/guacproto.go` (+ test).
