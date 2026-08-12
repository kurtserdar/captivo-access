# E2 — File transfer for remote-desktop gateway sessions

**Status:** approved design (2026-08-12)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Builds on:** E1 (`2026-08-12-guac-connection-params-design.md`, live v0.28.0) — reuses the
`GuacParams` allowlist, storage, resolution, descriptor, and handshake plumbing.

## Goal

Let a vendor upload files to and download files from a remote-desktop session, controlled by
per-resource + Policy toggles (enable / block-upload / block-download). RDP uses guacd's
virtual **drive** (a writable directory on the guacd host, isolated per session); SSH uses
**SFTP** over the SSH connection itself. Our custom browser client gains a minimal
drag-drop-upload + auto-download UI (no file browser).

## Parameters (extend E1 `GuacParams`)

Add three booleans to `GuacParams` (stored in the same `guacParams` JSON — **no schema change**):
`enableFileTransfer`, `blockUpload`, `blockDownload`.

`toGuacArgs` gains a `protocol` argument and maps them **protocol-aware**:
- `enableFileTransfer` && RDP → `enable-drive=true`, `create-drive-path=true`, `drive-name=Captivo`.
- `enableFileTransfer` && SSH → `enable-sftp=true`.
- VNC → nothing (Guacamole VNC has no file transfer).
- `blockUpload` → RDP `disable-upload=true` / SSH `sftp-disable-upload=true`.
- `blockDownload` → RDP `disable-download=true` / SSH `sftp-disable-download=true`.

`drive-path` is **not** a stored param — it is per-session and injected by the data-plane
(below), because only the data-plane knows the session id.

## Components

### 1. Param model (`src/lib/gateway/guac-params.ts`)

- `GuacParams` gains `enableFileTransfer?`, `blockUpload?`, `blockDownload?` (booleans);
  `parseGuacParams` accepts them (booleans only), `resolveGuacParams` merges them per-field.
- `toGuacArgs(p, clipboardMode, protocol)` — new third arg `protocol: "RDP" | "SSH" | "VNC"`;
  emits the file-transfer args per the mapping above (existing E1 args unchanged).
- Descriptor route passes `cred.protocol` (upper-cased) to `toGuacArgs`.

### 2. Per-session drive path (`dataplane/guactunnel.go`)

Before `buildConnect`, if the resolved `conn.Params["enable-drive"] == "true"`, set
`conn.Params["drive-path"] = "/drive/" + sessionID` (the session id already generated for the
hub). guacd (with `create-drive-path`) creates that empty dir, so each session gets an
isolated drive — one vendor never sees another's files.

### 3. guacd drive volume + cleanup

- **`src/lib/connector/repair.ts`** (gateway-host command):
  - Extend the busybox chown to also cover `/drive`, and mount `captivo_guacd_drive:/drive` on
    the guacd container.
  - Mount `captivo_guacd_drive:/drive:rw` on the **connector** container too, so it can prune.
- **`connector/drivecleanup.go`** (new): a goroutine that, when `/drive` exists, hourly removes
  top-level session dirs whose mtime is older than 12h (age-based; no session tracking).
  Bounded, self-contained; started from the connector's main only on a gateway host.

### 4. Browser file transfer (`src/app/gateway/[siteId]/session/session-client.tsx`)

- **Download:** `client.onfile = (stream, mimetype, filename) => …` — read via
  `Guacamole.BlobReader`, and on end trigger a browser download of the blob (an `<a download>`
  with `URL.createObjectURL`, revoked after). Shows a "Downloaded <name>" toast. (guacd's
  `disable-download` stops the file server-side, so nothing arrives when blocked.)
- **Upload:** `client.onfilesystem = (object) => { fsObject = object; setCanUpload(true); }`.
  Drag-drop files onto the session → for each, `fsObject.createOutputStream(mime, "/" + name)`
  → `Guacamole.BlobWriter(stream).sendBlob(file)`; a "Uploading… / Uploaded <name>" toast.
  (guacd's `disable-upload` / no filesystem = uploads simply don't happen.)
- A small **drop hint** appears while `canUpload` (bottom-left), and a transient **toast**
  (bottom-centre) reports transfers. Both `pointerEvents:none`, never blocking the session;
  drag-over/drop handlers live on the outer container.

### 5. UI toggles (`src/components/guac-params-fields.tsx`)

Add a **File transfer** group (shown for RDP + SSH, hidden for VNC): a `File transfer`
select (Default / On / Off) and, when not Off, `Block upload` and `Block download`
selects (Default / On / Off). `paramsToGuacFields` / `guacFieldsToParams` handle the three
new tri-state fields. The Policy "Remote-desktop defaults" and the resource "Advanced" both
render them (already wired via the shared component).

## Data flow

Resource/Policy → `guacParams` JSON (with the three new booleans) → descriptor resolves +
`toGuacArgs(..., protocol)` → data-plane injects per-session `drive-path` → `buildConnect`
emits the file-transfer args → guacd exposes the drive/SFTP → the browser client uploads via
drag-drop and auto-downloads what guacd streams.

## Error handling / edge cases

- **Blocked / disabled** — guacd enforces server-side; the client just handles what arrives
  (no filesystem = no drop target; no `onfile` = no download).
- **VNC** — no file-transfer args emitted; the UI hides the group.
- **Drive isolation** — per-session dir; cleanup prunes dirs >12h so the host doesn't fill.
- **Large files** — `BlobWriter`/`BlobReader` stream in chunks; a failed/aborted transfer
  toasts an error and is dropped (the session continues).
- **Fresh volume permissions** — the drive volume is chowned to uid 1000 like recordings/logs.

## Non-goals

- No in-browser file browser (navigate/rename/delete) — drag-drop up + auto-download only.
- No file-transfer audit trail (who moved which file) — deferred; the session is recorded.
- No VNC file transfer (unsupported by Guacamole).
- No new schema column (reuses `guacParams`).

## Testing

**TS (vitest, `guac-params.test.ts` — extend):** `toGuacArgs` file-transfer mapping — RDP on
→ `enable-drive`/`create-drive-path`/`drive-name`; SSH on → `enable-sftp`; VNC on → none;
`blockUpload`/`blockDownload` → the right per-protocol `disable-*` args.

**Go (`dataplane`):** the per-session `drive-path` injection — given `Params["enable-drive"]=="true"`,
the handshake args include `drive-path=/drive/<sessionID>`; absent when enable-drive is off.

**Go (`connector`):** the prune helper removes a dir older than the threshold and keeps a
recent one (using a temp dir + backdated mtime).

**Gate A (operator, after deploy):** on an RDP resource with File transfer On — drag a file
onto the session (it appears on the remote drive), and copy a file into the session's
Download folder (it downloads in the browser); Block upload / Block download each take effect;
two concurrent sessions don't see each other's files; on an SSH resource, SFTP upload/download
works; VNC shows no file-transfer options.

## Deploy notes

- **No schema change** (reuses `guacParams`). Manager + data-plane + **connector** all change,
  and the connector deploy command changes → gateway hosts must **re-run the connector Update
  command** to get the new connector image (with cleanup) + the drive volume mount. Bump
  `access-manager`, `access-dataplane`, `access-connector`. Suggested **v0.29.0**. English-only
  + GitHub Release note (tell operators to re-run the connector Update command).

## File map

**Modify:** `src/lib/gateway/guac-params.ts` (+ `.test.ts`),
`src/app/api/internal/gateway/descriptor/route.ts` (pass protocol),
`src/components/guac-params-fields.tsx` (file-transfer group),
`src/lib/connector/repair.ts` (drive volume + chown + connector mount),
`dataplane/guactunnel.go` (drive-path injection) + a Go test,
`src/app/gateway/[siteId]/session/session-client.tsx` (upload/download UI),
`src/app/globals.css` (drop hint + toast).
**Create:** `connector/drivecleanup.go` (+ test), wired from `connector` main on a gateway host.
