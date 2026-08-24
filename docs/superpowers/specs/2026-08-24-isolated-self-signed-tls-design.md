# Isolated Browser — Self-Signed TLS Targets — Design

**Date:** 2026-08-24
**Status:** Approved (design), pending implementation
**Related:** isolated browser / KasmVNC (RBI), `Site.insecureSkipVerify` (transparent proxy)

## Problem

An isolated-browser Resource pointed at an HTTPS target with a self-signed or
internal-CA certificate cannot be opened. The isolated Chromium
(`kasm-browser/control.py`) is launched **without** `--ignore-certificate-errors`,
so it rejects the target's certificate with `ERR_CERT_AUTHORITY_INVALID`
(Chromium `net_error -202`) and either shows the "connection is not private"
interstitial (un-clickable under `--kiosk`) or loads a broken UI whose HTTPS
XHR/polling all fail — flooding the engine log with repeated handshake errors
(observed against a Proxmox target, `https://…:8006`).

Most internal appliances/apps use self-signed or private-CA certs (Proxmox,
iDRAC/iLO, router/switch panels, self-hosted tools), so this blocks a large
class of legitimate isolated-browser targets.

## Context that shapes the design

`Site.insecureSkipVerify` **already exists** and already works for the
`TRANSPARENT` (web-app reverse proxy) access mode — the site form exposes it as
"Allow self-signed certificate (skip TLS verification)". It is simply **not
wired into the ISOLATED path**: the site form only shows the checkbox for
`TRANSPARENT`, the gateway descriptor doesn't return it for ISOLATED, the
data-plane doesn't forward it, and the broker doesn't act on it. This design
extends the existing field to the isolated path rather than adding anything new.

## Goals

- An isolated-browser Resource can open an HTTPS target with a self-signed /
  internal-CA cert when the operator opts in.
- Reuse the existing `Site.insecureSkipVerify` field and its existing
  security framing — no new field, no schema change.
- Default `false` (current behaviour unchanged): only a Resource whose operator
  explicitly enables it skips certificate verification.
- Fix the cosmetic `BrokenPipeError` traceback the broker logs on session close.

## Non-goals

- No per-host SPKI pinning. The isolated session already navigates to exactly
  one target (`navigateUrl`), is throwaway and server-side, and the operator
  opts in per Resource — a blanket `--ignore-certificate-errors` on that session
  is sufficient and simpler.
- No change to the `TRANSPARENT` path (already works).
- No change to how the credential/target reaches the connector.

## Design

The existing `insecureSkipVerify` boolean flows the length of the isolated
pipeline: site form → descriptor → data-plane → broker → Chromium flag.

### 1. Site form (`src/app/(app)/admin/sites/site-form.tsx`)

The "Allow self-signed certificate" checkbox is currently rendered only inside
the `accessMode === "TRANSPARENT"` block. Render the same control inside the
`accessMode === "ISOLATED"` block too, bound to the existing
`insecureSkipVerify` state, with wording adapted to the isolated case
(e.g. "the isolated browser won't verify the target's certificate — only for
internal devices you trust"). The submit payload already includes
`insecureSkipVerify`.

### 2. Create/update routes (`src/app/api/admin/sites/**`)

Verify the ISOLATED create/update path persists `insecureSkipVerify` (the
field exists; confirm it isn't dropped for ISOLATED). If it's only persisted on
the TRANSPARENT branch, add it to the ISOLATED branch.

### 3. Gateway descriptor (`src/app/api/internal/gateway/descriptor/route.ts`)

- Add `insecureSkipVerify: true` to the `site.findUnique` `select`.
- In the `ISOLATED` response object, add
  `insecureSkipVerify: site.insecureSkipVerify`.

### 4. Data-plane (`dataplane/kasmtunnel.go`)

- Add `InsecureSkipVerify bool \`json:"insecureSkipVerify"\`` to the `kasmDesc`
  struct.
- `openKasmSession(...)` gains an `insecure bool` parameter and adds
  `,"insecure":` + `strconv.FormatBool(insecure)` to the JSON body it posts to
  the broker's `POST /session`.
- `serveKasmTunnel` passes `d.InsecureSkipVerify` into `openKasmSession`.

### 5. Broker (`kasm-browser/control.py`)

- `do_POST` `/session` handler reads `insecure = bool(data.get("insecure", False))`.
- `open_session(...)` and `_spawn(...)` gain an `insecure=False` parameter.
- In `_spawn`, when `insecure` is true, add `--ignore-certificate-errors` to the
  Chromium argument list (before the `url`). When false, launch unchanged.

### 6. BrokenPipe cleanup (`kasm-browser/control.py`)

The session-close response race throws `BrokenPipeError` from `_json` →
`wfile.write` when the data-plane closes the relay before reading the broker's
reply. Wrap the response write (in `_json`, or the `do_POST` dispatch) so
`(BrokenPipeError, ConnectionResetError)` is swallowed quietly instead of
surfacing a socketserver traceback. The session already closes cleanly; this is
log-noise only.

## Security framing

`insecureSkipVerify` disables certificate verification on the **connector →
target** leg, inside the customer network, for a single opted-in Resource. The
operator turns it on knowingly (same as the transparent path), and the isolated
browser is server-side and throwaway. The existing hint copy already states the
trust boundary; the isolated variant repeats it. Default off keeps every
existing Resource verifying certificates.

## Testing

- **Broker unit/behaviour** (`kasm-browser/control.py`): the isolated engine has
  no test harness in-repo; verify by build + manual: an ISOLATED Resource with
  `insecureSkipVerify` on opens a self-signed HTTPS target (Proxmox) without the
  `net_error -202` flood; with it off, the cert is still rejected (unchanged).
- **Data-plane** (`dataplane/kasmtunnel_test.go` if present, else build): the
  `openKasmSession` body includes `"insecure":true/false` matching the arg.
- **Descriptor**: build + confirm the ISOLATED response carries
  `insecureSkipVerify`.
- **BrokenPipe**: manual — closing an isolated session no longer prints a
  traceback in the engine log.

## Rollout

- **Connector-side change** (the `kasm-browser` image): it takes effect only
  after the operator updates the connector (**Re-pair / Update** in the console,
  which re-pulls `captivo-access-kasm-browser:latest`). Manager + data-plane
  changes deploy with the release; the broker change rides the connector update.
- Ship as its own release tag; bump the manager (descriptor + form) and
  data-plane (kasmtunnel). English user-facing release note ("isolated browser
  can now open internal HTTPS targets with self-signed certificates, per
  Resource").
- Deploy is a separate, explicitly-approved step.
