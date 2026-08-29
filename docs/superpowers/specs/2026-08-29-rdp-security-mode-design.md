# RDP Security Mode — Selectable per Resource — Design

**Date:** 2026-08-29
**Status:** Approved (design), pending implementation
**Related:** gateway RDP (guacd), `guac-params`, `buildConnect`

## Problem

RDP sessions fail with `RDP server closed/refused connection: Server refused
connection (wrong security type?)` after a Windows update. The gateway always
sends `security=any` (guacd negotiate), hard-coded in `dataplane/guacproto.go`
(`buildConnect`), with no way to change it. Modern/updated Windows hosts that
require NLA (or TLS) reject the `any` negotiation path — a known FreeRDP
behaviour. SSH sessions on the same connector/guacd work fine, confirming the
issue is isolated to the RDP security layer.

## Context

- `buildConnect` (guacproto.go) fills each guacd-requested arg: most come from
  `c.Params[name]` (produced by `toGuacArgs`), but `security`, `ignore-cert`,
  and `resize-method` are hard-coded. `security` → `"any"`.
- `GuacParams` (`src/lib/gateway/guac-params.ts`) is the curated per-resource +
  policy-default RDP/SSH/VNC parameter set, surfaced in the site form via
  `GuacParamsFields`. It has no security field today.
- `ignore-cert=true` is already sent, so a self-signed target cert (which
  NLA/TLS present) is accepted — no extra work needed there.

## Goals

- Let an operator choose the RDP security mode per resource: **Automatic (any)**,
  **NLA**, **TLS**, or **RDP**.
- Default **Automatic (`any`)** — existing resources keep today's exact
  behaviour; no migration, no surprise.
- Selecting **NLA** should fix the updated-Windows case (credentials are already
  injected server-side, so NLA auth can complete).

## Non-goals

- No change to `ignore-cert` or `resize-method`.
- No `nla-ext` / `vmconnect` for now — add later if a target needs them.
- SSH/VNC unaffected (security mode is RDP-only).

## Design

The value flows the existing param path: site form → `GuacParams.rdpSecurity`
→ `toGuacArgs` → `c.Params["security"]` → `buildConnect`.

### 1. `guac-params.ts`

- Add `rdpSecurity?: string` to `GuacParams`.
- `parseGuacParams`: accept only a curated set — `const RDP_SECURITY = new Set(["any","nla","tls","rdp"])`; keep `rdpSecurity` only if in the set.
- `resolveGuacParams`: add `rdpSecurity: resource.rdpSecurity ?? policy.rdpSecurity`.
- `toGuacArgs` (RDP branch is protocol-gated already): when `protocol === "RDP"` and `p.rdpSecurity` is set, `a["security"] = p.rdpSecurity`. (Not emitted for SSH/VNC.)

### 2. `dataplane/guacproto.go` — `buildConnect`

Make the `security` case param-aware, defaulting to `any` when unset:

```go
case name == "security":
    if v, ok := c.Params["security"]; ok && v != "" {
        elems = append(elems, v)
    } else {
        elems = append(elems, "any") // default: let guacd negotiate
    }
```

So a resource with `rdpSecurity` set overrides; everything else stays `any`.

### 3. `GuacParamsFields` (site form)

Add an **RDP security** `<select>` in the RDP params block (shown only for RDP,
like the other RDP-only fields): Automatic (default, empty value) / NLA / TLS /
RDP. Bound to the `rdpSecurity` field. Include a short hint: *"Set to NLA if an
updated Windows host refuses the connection ('wrong security type')."*

## Testing

- `guac-params` unit tests (`guac-params.test.ts` if present): `parseGuacParams`
  keeps a valid `rdpSecurity`, drops an invalid one; `toGuacArgs` emits
  `security` for RDP when set and omits it for SSH/VNC and when unset.
- guacproto/dataplane: build (no unit harness for buildConnect necessarily) —
  verify a set value overrides and unset defaults to `any`.
- Manual (the real fix): set the failing RDP resource's security to **NLA**,
  connect — the session opens instead of "wrong security type".

## Rollout

- **Manager + data-plane** change (form/params in manager, buildConnect in
  data-plane). No schema change (rdpSecurity lives in the existing
  `guacParams` JSON), no connector/kasm change.
- Ship as its own release tag; bump manager + data-plane. English user-facing
  release note.
- Deploy is a separate, explicitly-approved step (data-plane change drops live
  gateway/isolated sessions on restart).
