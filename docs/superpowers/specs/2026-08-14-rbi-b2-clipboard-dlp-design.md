# RBI Transport B (KasmVNC) — Clipboard DLP Design (B2)

**Date:** 2026-08-14
**Status:** Approved (brainstorm)
**Slice:** RBI B2 — clipboard data-leak control for the high-fidelity isolated browser (the A3 equivalent for transport B)

## Goal

Make the high-fidelity (KasmVNC) isolated browser honor the site's per-site
`clipboardMode`, so an admin can block copy-out (isolated desktop → vendor
clipboard) and/or paste-in (vendor → isolated desktop) exactly as transport A
(VNC via guacd) already does. Today the hi-fi session applies no clipboard
restriction — copy and paste flow freely regardless of `clipboardMode`.

This slice is **clipboard only**. Other KasmVNC DLP knobs (watermark, region
blackout, keyboard rate-limit) are a separate future slice. Clipboard control
stays **per-site** (the existing `Site.clipboardMode` select) — no policy/settings
layer in this slice.

## Background

`Site.clipboardMode` is a `String` (`allow | no_copy | no_paste | none`, default
`allow`) already set on the site form's ISOLATED section (added in A3). Transport
A maps it in `toGuacArgs` (`no_copy`/`none` → `disable-copy`; `no_paste`/`none` →
`disable-paste`). The standard (A) ISOLATED descriptor branch already passes
`toGuacArgs({}, site.clipboardMode, "VNC")`. The hi-fi (kasm) branch does not — it
returns `transport:"kasm"` with no clipboard information.

The KasmVNC broker (B-concurrency, v0.62.0) spawns a per-session `Xvnc` per
vendor. KasmVNC's clipboard direction is governed by its data-loss-prevention
config in `kasmvnc.yaml`, read by each `Xvnc` at start. So per-session clipboard
control means per-session config.

## KasmVNC DLP findings (verified in the image)

`kasmvnc_defaults.yaml` ships:

```yaml
data_loss_prevention:
  clipboard:
    server_to_client:
      enabled: true          # copy-out: isolated desktop -> vendor clipboard
      primary_clipboard_enabled: false
    client_to_server:
      enabled: true          # paste-in: vendor -> isolated desktop
runtime_configuration:
  allow_client_to_override_kasm_server_settings: true
  allow_override_list:
    - pointer.enabled
    - data_loss_prevention.clipboard.server_to_client.enabled   # <-- HOLE
    - data_loss_prevention.clipboard.client_to_server.enabled    # <-- HOLE
    - data_loss_prevention.clipboard.server_to_client.primary_clipboard_enabled
```

**Critical:** the default `allow_override_list` lets the CLIENT re-enable the
clipboard from the KasmVNC web client, which would defeat the DLP. The per-session
config MUST drop the clipboard keys from `allow_override_list` so the restriction
holds. (The RFB-level `SendCutText`/`AcceptCutText` params also exist but govern
the legacy RFB clipboard, not KasmVNC's rich web-client clipboard channel — the
DLP yaml is the authoritative, web-client-gating mechanism.)

## clipboardMode → KasmVNC mapping

| clipboardMode | server_to_client (copy-out) | client_to_server (paste-in) |
|---|---|---|
| `allow` | true | true |
| `no_copy` | **false** | true |
| `no_paste` | true | **false** |
| `none` | **false** | **false** |
| (unknown/empty) | true | true (default allow — no B1 regression) |

## Approach

**Per-session DLP yaml (chosen).** The broker writes a per-session
`kasmvnc.yaml` reflecting the site's clipboard policy and starts that session's
`Xvnc` with a per-session `HOME` so it reads its own config. The always-on hub
(static web client) is unaffected.

Rejected: RFB CLI flags (`-SendCutText=0`/`-AcceptCutText=0`) — they gate the
legacy RFB clipboard, not the KasmVNC web-client clipboard, so they risk leaving a
DLP hole; unverifiable headlessly.

The `clipboardMode` → booleans mapping lives in the data-plane (Go, unit-tested);
the broker just receives two booleans and writes the yaml (yaml mechanics only).

## Components

### 1. Manager — descriptor kasm branch (`src/app/api/internal/gateway/descriptor/route.ts`)

The kasm branch (currently lines 37–46) adds one field to its response:

```ts
if (site.isolationHiFi) {
  return NextResponse.json({
    transport: "kasm",
    navigateUrl: site.upstreamUrl ?? "",
    kasmAddr: (process.env.ISOLATED_KASM_ADDR ?? "captivo-kasm:6901").trim(),
    kasmControlAddr: (process.env.ISOLATED_KASM_CONTROL_ADDR ?? "captivo-kasm:7900").trim(),
    connectorId: site.connectorId,
    clipboardMode: site.clipboardMode,   // <-- added; select already fetches it
    record: false, // hi-fi recording = B3
  });
}
```

### 2. Data-plane (`dataplane/kasmtunnel.go`)

- `kasmDesc` gains `ClipboardMode string \`json:"clipboardMode"\``.
- New helper:

```go
// clipboardToKasm maps the site clipboardMode (allow|no_copy|no_paste|none) to the
// KasmVNC DLP booleans: copyOut = server_to_client (isolated -> vendor), pasteIn =
// client_to_server (vendor -> isolated). Unknown/empty defaults to allow (no B1
// regression); the restrictive values are the ones that must be explicit.
func clipboardToKasm(mode string) (copyOut, pasteIn bool) {
	switch mode {
	case "no_copy":
		return false, true
	case "no_paste":
		return true, false
	case "none":
		return false, false
	default: // "allow" and any unknown value
		return true, true
	}
}
```

- `openKasmSession` signature gains the two booleans and includes them in the
  POST body:

```go
func openKasmSession(rw io.ReadWriter, host, target string, copyOut, pasteIn bool) (id string, port, status int, err error) {
	body := `{"url":` + jsonQuoteKasm(target) +
		`,"copyOut":` + strconv.FormatBool(copyOut) +
		`,"pasteIn":` + strconv.FormatBool(pasteIn) + `}`
	// ... unchanged: write POST /session, read response, parse {id,port}
}
```

- `serveKasmTunnel` WS-upgrade branch maps and passes the flags:

```go
co, pi := clipboardToKasm(d.ClipboardMode)
id, port, status, e = openKasmSession(st, d.KasmControlAddr, d.NavigateUrl, co, pi)
```

### 3. Broker (`kasm-browser/control.py`)

- `POST /session` body now carries `copyOut`/`pasteIn` (default `true` when
  absent — allow):

```python
url = data.get("url", "")
copy_out = data.get("copyOut", True)
paste_in = data.get("pasteIn", True)
```

- `_spawn` writes a per-session config under a per-session `HOME` and starts
  `Xvnc` with that `HOME` so it reads its own `~/.vnc/kasmvnc.yaml`:

```python
def _session_yaml(copy_out, paste_in):
    return (
        "network:\n"
        "  protocol: http\n"
        "  ssl:\n"
        "    require_ssl: false\n"
        "  udp:\n"
        "    public_ip: 127.0.0.1\n"
        "runtime_configuration:\n"
        "  allow_client_to_override_kasm_server_settings: true\n"
        "  allow_override_list:\n"
        "    - pointer.enabled\n"   # clipboard keys omitted -> client cannot re-enable
        "data_loss_prevention:\n"
        "  clipboard:\n"
        "    server_to_client:\n"
        "      enabled: " + ("true" if copy_out else "false") + "\n"
        "      primary_clipboard_enabled: false\n"
        "    client_to_server:\n"
        "      enabled: " + ("true" if paste_in else "false") + "\n")
```

  In `_spawn(display, url, profile, home, copy_out, paste_in)`:
  - `os.makedirs(home + "/.vnc", exist_ok=True)`
  - write `_session_yaml(...)` to `home + "/.vnc/kasmvnc.yaml"`
  - spawn `Xvnc` (and `fluxbox`, `chromium`) with `env = {**os.environ, "DISPLAY": disp, "HOME": home}`

- Session record stores `home`; `_kill` also `shutil.rmtree(home)` (per-session
  config/logs) alongside the profile.

### 4. Unchanged

Prisma schema (`clipboardMode` exists); the site form's ISOLATED Clipboard select
(A3); the hub and its global `/kasmvnc.yaml`; the descriptor `select`; `repair.ts`
bundle; the concurrency broker contract (ports, MAX_SESSIONS, TTL reaper).

## Data flow

1. Vendor opens a hi-fi ISOLATED site whose `clipboardMode` is e.g. `no_copy`.
2. WS upgrade → `serveKasmTunnel` calls the descriptor → gets
   `clipboardMode:"no_copy"` → `clipboardToKasm` → `(copyOut=false, pasteIn=true)`.
3. `openKasmSession` posts `{"url":…,"copyOut":false,"pasteIn":true}` to the broker.
4. Broker writes the per-session yaml (`server_to_client.enabled: false`) under the
   session's HOME and starts that `Xvnc` → copy-out is blocked; paste-in works.
5. WS ends → session closed → per-session profile + HOME reaped.

## Error handling / edge cases

- Missing/unknown `clipboardMode` or absent `copyOut`/`pasteIn` → allow (both
  true) — preserves current B1 behaviour, no regression.
- Per-session yaml write failure → the session still starts (fail-open on the
  mechanism, not on access) but without the restriction; the broker logs it. This
  matches "never hard-fail a session"; the operator sees the log. (Acceptable for
  this slice; a stricter fail-closed is a future hardening.)
- Client attempts to re-enable clipboard from the web UI → blocked (clipboard keys
  are not in `allow_override_list`).
- Concurrency unaffected: each session's HOME/yaml is independent.

## Testing / verification

- **Go unit tests** (`dataplane/kasmtunnel_test.go`):
  - `clipboardToKasm`: `allow`→(t,t), `no_copy`→(f,t), `no_paste`→(t,f),
    `none`→(f,f), `""`/`"bogus"`→(t,t).
  - `openKasmSession` writes `"copyOut":false` / `"pasteIn":true` into the POST
    body (extend the existing `TestOpenKasmSessionOK`-style test with the flags).
- **Local broker spike**: build the image, `POST /session {"url":…,"copyOut":false,"pasteIn":true}`,
  read the per-session `~/.vnc/kasmvnc.yaml` → confirm
  `server_to_client.enabled: false` and `client_to_server.enabled: true`, and that
  `allow_override_list` has no clipboard keys. Re-run the MAX_SESSIONS=3 concurrency
  spike to confirm no regression.
- `pnpm build` (manager — descriptor change) + `go build ./...` + `go test ./...`.

## Deployment (SEPARATE GATE — explicit user approval required)

Target **v0.63.0** — `manager` (descriptor field) + `dataplane` + `kasm-browser`
images. No schema. Bump all three image tags; `docker compose pull` +
`up -d access-manager access-dataplane`; **Update the gateway connector** to pull
the new `captivo-kasm:latest` (broker DLP). Verify `/login` 200. English
`gh release edit` note. No Claude signature.

**Gate-A (operator):** a hi-fi ISOLATED site with Clipboard = "Block copy out" →
copy text inside the isolated Proxmox → paste into a local (vendor) app → nothing
transfers; a site with "Allow" still copies; paste-in behaves per its mode.

## Global constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Transport B must not depend on `isolated.go` (transport A, deleted after B3).
- Clipboard control is per-site (no policy layer this slice); watermark/region DLP
  is a separate future slice.
- Deploy requires explicit user approval; every tag gets an English user-focused
  `gh release edit` note.
