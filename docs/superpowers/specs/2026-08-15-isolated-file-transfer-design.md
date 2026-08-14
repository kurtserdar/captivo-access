# Isolated Browser File Transfer — Design

**Date:** 2026-08-15
**Status:** Approved (design)
**Access mode:** ISOLATED (KasmVNC-based isolated browser)

## Problem

The ISOLATED access method (KasmVNC isolated Chromium) has no way to move
files between the vendor and the isolated browser. GATEWAY already supports
file transfer natively through guacd (SSH `enable-sftp`, RDP
`enable-drive`/`drive-path`, audited by `ftObserver`). ISOLATED has no
equivalent.

**Key finding from the exploration spike:** the bundled open-source KasmVNC
server (Xvnc + `www` client) exposes **no native file transfer** — the
feature belongs to the full Kasm Workspaces product, not the OSS server. So
isolated file transfer must be built as our own channel, not wired to a
KasmVNC feature.

## Goal

Bidirectional file transfer for isolated sessions:

- **Upload** (vendor → isolated browser): the vendor pushes a file into the
  isolated Chromium so it can be used in the web app's file picker.
- **Download** (isolated → vendor): files the isolated Chromium downloads
  are surfaced back to the vendor to pull.

Both directions are governed by a per-site DLP control, default off.

## Non-goals

- No change to GATEWAY file transfer (works, audited).
- No persistence: transferred files are ephemeral, wiped on session close.
- No file-type allowlist (all types allowed; audit records who moved what).
- No change to the KasmVNC iframe / RFB stream.

## Architecture

An isolated session is two separate browser connections: the outer React
page (`isolated-client.tsx`) and the KasmVNC iframe (relayed via
`/kasm-tunnel`). **File transfer flows entirely through the outer page** and
never touches the iframe or the RFB protocol.

```
Vendor browser
  → manager  /api/isolated/files/*   (NextAuth; resolves userId)
  → dataplane /kasm-files            (userId + siteId)
  → hub lookup: active isolated session → brokerSID, kasmControlAddr, connectorId, fileTransferMode
  → connector control channel
  → broker (control.py) HTTP endpoint on kasmControlAddr
  → session home dir  /sess/<sid>/...
```

**Session correlation.** The outer page knows only `siteId`. There is
exactly one active isolated session per (userId, siteId), so the dataplane
resolves the target session from the session hub by (userId, siteId). This
requires the hub registration to carry the broker session id, the broker
control address, and the DLP mode (see "Data model — hub" below).

**Broker reachability.** The dataplane already reaches the broker control
API (`kasmControlAddr`, default `captivo-kasm:7900`) by dialing through the
connector control channel — this is exactly how `openKasmSession` posts to
the broker to start a session. File transfer reuses the same mechanism: open
a fresh relay to `kasmControlAddr`, issue HTTP POST/GET to the new broker
endpoints.

## File locations (inside the broker container)

The broker launches Chromium with `HOME=/sess/<sid>`. Two directories under
that home, kept separate so the two directions never collide:

| Direction | Directory | Rationale |
|---|---|---|
| Upload (vendor → isolated) | `/sess/<sid>/` (HOME root) | The GTK file chooser opens at `$HOME`, so uploaded files are immediately visible in the web app's file picker. |
| Download (isolated → vendor) | `/sess/<sid>/Downloads/` | Chromium's default download directory. The download tray lists **only** this folder. |

Both live under `/sess/<sid>`, which `_kill` already removes via
`shutil.rmtree(sess["home"])` on session close. Transfers are ephemeral by
design — aligned with the isolation model.

**Chromium download directory.** The broker must ensure Chromium writes
downloads to `/sess/<sid>/Downloads/`. With `HOME=/sess/<sid>` Chromium's
default is `$HOME/Downloads`; the broker creates that directory at spawn so
it exists before first use. (If a spike shows Chromium not honoring the
default, set `download.default_directory` in the profile `Preferences` JSON
written before launch.)

## Data model

### Site (Prisma schema)

Add one field mirroring `clipboardMode`:

```prisma
fileTransferMode String @default("none") // allow | no_upload | no_download | none (ISOLATED only)
```

- `allow` — both directions permitted
- `no_upload` — download only
- `no_download` — upload only
- `none` — file transfer disabled (default)

Default `none`: the isolated browser exists to isolate; file transfer is a
deliberately opened hole an admin turns on per site.

### Session hub (dataplane)

`RegisterIsolated` gains three stored fields so the file-transfer handler
can address the right broker session and enforce DLP without re-fetching the
descriptor:

- `brokerSID string` — the broker session id returned by `openKasmSession`
- `kasmControlAddr string` — broker control address for this session
- `fileTransferMode string` — resolved per-site DLP mode

## Components

### 1. Broker — `kasm-browser/control.py`

Three new HTTP endpoints (same `BaseHTTPRequestHandler` as existing routes):

- `POST /session/<sid>/upload` — request body is the file bytes; filename in
  a header (e.g. `X-Filename`). Sanitize to basename, strip `..` and path
  separators. Reject if size exceeds the cap. Write to `/sess/<sid>/`
  (HOME root). Return `{ "ok": true, "name": "<sanitized>" }`.
- `GET /session/<sid>/downloads` — list `/sess/<sid>/Downloads/` as JSON:
  `[{ "name", "size", "mtime" }]`. Empty array if the folder is empty or
  missing. Skip in-progress Chromium temp files (`.crdownload`).
- `GET /session/<sid>/downloads/<name>` — stream one file from
  `/sess/<sid>/Downloads/`, basename-sanitized. 404 if absent.

Unknown/closed `sid` → 404. All paths are confined to the session home;
reject any name that resolves outside it.

### 2. Dataplane — new `/kasm-files` handler

A single handler (new file, e.g. `kasmfiles.go`) with sub-routes for upload,
list, and download-one. For every request:

1. Resolve the active isolated session by (userId, siteId) from the hub.
   No session → 409.
2. Read `fileTransferMode` from the hub entry and enforce:
   - upload requires mode `allow` or `no_download`
   - download (list + fetch) requires mode `allow` or `no_upload`
   - blocked → 403 **and** enqueue an audit DENY event
3. Dial the broker via the connector control channel to `kasmControlAddr`
   and relay the HTTP call to the matching broker endpoint using `brokerSID`.
4. On success, enqueue an audit ALLOW event with the verb, filename, and
   byte count.

**Audit.** Reuse the existing verbs in `guacfiletransfer.go`
(`verbUpload`, `verbDownload`). Emit `AuditEvent`s consistent with the
gateway file-transfer events (decision, reason carrying verb + filename,
userID, siteID, host = NavigateUrl, bytes). DLP blocks emit `DENY` with the
attempted verb.

### 3. Descriptor — `src/app/api/internal/gateway/descriptor/route.ts`

Add `fileTransferMode: site.fileTransferMode` to the ISOLATED descriptor
branch (add `fileTransferMode` to the `site.findUnique` select). The
dataplane kasm tunnel reads it from `kasmDesc` and stores it in the hub at
`RegisterIsolated`.

Add the field to the `kasmDesc` struct in `dataplane/kasmtunnel.go`.

### 4. Manager API — new routes under `src/app/api/isolated/files/`

- `POST /api/isolated/files/upload?site=<id>` — NextAuth-authenticated;
  verify the user holds an active grant/session for the site; enforce the
  size cap; proxy the bytes to the dataplane. (Manager also enforces the cap
  so oversized uploads are rejected before crossing to the dataplane.)
- `GET /api/isolated/files/downloads?site=<id>` — returns the broker's JSON
  listing via the dataplane.
- `GET /api/isolated/files/download?site=<id>&name=<f>` — streams one file
  via the dataplane.

Auth mirrors the existing isolated-session authorization (same grant check
used to open the session).

### 5. UI — `src/app/gateway/[siteId]/session/isolated-client.tsx`

The isolated session page gains file-transfer controls gated by the site's
`fileTransferMode` (passed from the server component that renders the page,
from `site.fileTransferMode`):

- **Upload** (mode `allow` or `no_download`): an "Upload file" button backed
  by a hidden `<input type="file">`; on select, POST to the upload endpoint;
  show a brief success/error state.
- **Download tray** (mode `allow` or `no_upload`): a "Downloads" tray that
  polls `/api/isolated/files/downloads` every ~3 s. New files appear in the
  list with a badge count; clicking a file downloads it via the
  download-one endpoint.

When mode is `none`, neither control renders. The UI gate is convenience;
the security boundary is the dataplane handler.

## Limits

- Per-file cap ~100 MB per direction, enforced at the manager (reject early)
  and guarded at the broker. Configurable via env (mirror the
  recording-max-bytes pattern).
- All file types allowed.

## Edge cases

- **Path traversal:** broker sanitizes every filename to basename and
  rejects names resolving outside the session home.
- **Same-name upload:** overwrite (simple, ephemeral).
- **In-progress downloads:** the listing skips Chromium `.crdownload` temp
  files so the vendor only sees completed downloads.
- **No active session:** 409 from the dataplane.
- **Session ends mid-transfer:** the relay connection closes; the error
  surfaces to the manager and then the UI.
- **DLP mid-session:** mode is fixed at session open (stored in the hub);
  changing the site setting affects the next session, not the live one —
  consistent with clipboard/watermark behavior.

## Testing

- **Broker:** unit-test filename sanitization (basename, `..` rejection),
  the `.crdownload` skip in the listing, and the size guard. (Python; match
  existing control.py test conventions if any, else a small script.)
- **Dataplane:** table test for DLP enforcement — each `fileTransferMode`
  value × direction → allowed/denied, asserting 403 + DENY audit on block
  (mirror `kasmtunnel_test.go` / `clipboardToKasm` test style).
- **Dataplane:** session-resolution test — (userId, siteId) with/without an
  active hub entry → relay/409.
- **Manager:** size-cap rejection and auth (unauthorized user → 401/403).
- **Build:** `pnpm build` (manager typecheck) + `go build`/`go test` in
  `dataplane`.
- **Manual (post-deploy):** with a real connector, upload a file into an
  isolated session and pick it in the web app; download a file in the
  isolated Chromium and pull it from the tray; verify each
  `fileTransferMode` gates the right direction; confirm audit rows.

## Release

Deploy and release notes are separate standing gates — do **not** auto-run;
wait for explicit approval. On tag, add an English user-focused
`gh release edit` note. Schema change → `prisma migrate` (per the
migrate/`--accept-data-loss` conventions if the diff is destructive; adding
a defaulted column is not).
