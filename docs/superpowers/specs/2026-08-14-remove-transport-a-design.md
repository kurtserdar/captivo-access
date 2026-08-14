# Remove RBI Transport A (VNC-via-guacd Isolated Browser) — Design

**Date:** 2026-08-14
**Status:** Approved (brainstorm)
**Slice:** Delete transport A now that transport B (KasmVNC) has full parity — no residue anywhere.

## Goal

Remove the VNC-via-guacd isolated browser (transport A) completely. `ISOLATED`
becomes **always KasmVNC** (transport B); the Standard/High-fidelity choice
disappears. After this slice, a repo grep for `isolationHiFi`, `captivo-browser`,
`isolated.go`, or `ISOLATED_BROWSER` returns nothing except historical
spec/plan/changelog text.

Transport B reached full parity and passed Gate-A across B1 (transport),
B-concurrency, B2 (clipboard DLP), and B3 (recording), so A is dead weight — a
second isolated-browser image on every gateway host (~343 MB) and a parallel code
path.

## Background

`isolationHiFi` is only the A-vs-B selector: `false` → transport A (guacd + the
`captivo-browser` image), `true` → transport B (KasmVNC). With A gone there is
nothing to select — `ISOLATED` is unconditionally KasmVNC — so the flag is dead and
the column is dropped. Any existing `isolationHiFi = false` site silently moves to
KasmVNC (intended; B is a strict superset).

`serveGuacTunnel` in `dataplane/guactunnel.go` serves BOTH the native **GATEWAY**
desktop (RDP/SSH/VNC, which stays) and the A-**ISOLATED** browser (the
`if navigateUrl != ""` block, which goes). The removal must not touch the GATEWAY
path. `browserproxy.go` is the transparent identity-aware proxy — unrelated to A,
untouched.

## Changes

### Data-plane

- **Delete** `dataplane/isolated.go` + `dataplane/isolated_test.go` entirely
  (`openBrowserSession`, `buildCloseRequest`, `buildNavigateRequest`, `isoGuard`,
  `jsonQuote`). `jsonQuote` is used only here — B uses its own `jsonQuoteKasm`.
- **`dataplane/guactunnel.go`**: remove the A-ISOLATED block (the
  `if navigateUrl != "" { … openBrowserSession … buildCloseRequest … }` around
  lines 64–95) and its teardown. Keep the GATEWAY guacd bridge + recording. The
  `GatewayDescriptor` call at line 49 stops receiving `navigateUrl`/
  `browserControlAddr`.
- **`dataplane/controlclient.go`**: drop `NavigateUrl` / `BrowserControlAddr` from
  the `GatewayDescriptor` JSON struct and its return tuple (only A consumed them);
  update the call site in guactunnel.go accordingly.

### Manager

- **`src/app/api/internal/gateway/descriptor/route.ts`**: in the
  `accessMode === "ISOLATED"` branch, delete the standard (VNC) sub-branch
  (`protocol:"vnc"`, `targetHost` from `ISOLATED_BROWSER_ADDR`, `browserControlAddr`,
  `guacdAddress`, `navigateUrl`). ISOLATED now always returns the kasm descriptor
  (transport/navigateUrl/kasmAddr/kasmControlAddr/connectorId/clipboardMode/record).
  Remove `isolationHiFi` from the `db.site.findUnique` select and the `if
  (site.isolationHiFi)` conditional (unconditional).
- **`src/app/(app)/admin/sites/site-form.tsx`**: remove the "Streaming quality"
  (Standard/High-fidelity) select and the `isolationHiFi` state + `SiteInitial`
  field + submit-body field. The ISOLATED section keeps Clipboard (B2) and Record
  (B3) — no transport choice.
- **`src/lib/site/validate.ts`** (+ `validate.test.ts`): remove `isolationHiFi`
  from the ISOLATED success variant type and the assignment.
- **`src/app/api/admin/sites/route.ts`** + **`[id]/route.ts`**: remove
  `isolationHiFi` from the ISOLATED create/update `data`.
- **`src/app/(app)/admin/sites/[id]/edit/page.tsx`**: remove `isolationHiFi` from
  the site select and the `SiteForm site={…}` props.
- **`src/app/gateway/[siteId]/session/page.tsx`**: change
  `if (site.accessMode === "ISOLATED" && site.isolationHiFi)` to
  `if (site.accessMode === "ISOLATED")` (always the kasm iframe). Remove
  `isolationHiFi` from the select. The guac-client fallback (`GatewaySession`) stays
  for GATEWAY only; ISOLATED never reaches it.

### Schema (the design decision — drop the column)

- **`prisma/schema.prisma`**: remove `isolationHiFi Boolean @default(false)` from
  `model Site`. Dropping a populated column requires a one-off
  `prisma db push --accept-data-loss` at deploy (documented pattern) — the standard
  `access-migrate` run refuses a destructive diff. The dropped data is only the dead
  A-vs-B flag.

### Bundle / image / CI / docs

- **`src/lib/connector/repair.ts`**: remove the `captivo-browser` block (the
  `docker pull … && docker rm -f captivo-browser … ; docker run … captivo-browser …`
  lines) from `runCommand`. Update `repair.test.ts` assertions that reference
  `captivo-access-browser`.
- **Delete `browser/` directory** (the A image source: `Dockerfile`, `control.py`,
  `entrypoint.sh`, any yaml).
- **`.github/workflows/publish.yml`**: remove the `captivo-access-browser` /
  `browser/Dockerfile` matrix entry so CI stops building/publishing that image.
- **`docs/install.md`**: remove references to the standard isolated browser /
  `captivo-browser` / `ISOLATED_BROWSER_ADDR`.

### Keep (do NOT touch)

`kasm-browser/` (transport B), `browserproxy.go` (transparent proxy),
`guactunnel.go` GATEWAY path + `guacrecord.go` + `guacproto.go` +
`guacfiletransfer` (native gateway), the guacd bundle in `repair.ts`,
`Site.clipboardMode` + `Site.recordSessions` columns (used by B2/B3), the kasm
descriptor env defaults (`ISOLATED_KASM_ADDR` / `ISOLATED_KASM_CONTROL_ADDR`).

## Error handling / edge cases

- Existing `isolationHiFi = false` ISOLATED sites → become KasmVNC automatically
  (accessMode unchanged). No data migration needed beyond dropping the column.
- The old `captivo-browser` container keeps running on the gateway host until the
  operator removes it. The connector Update (v0.65.0) no longer bundles/starts it;
  the operator runs `docker rm -f captivo-browser` to reclaim the ~343 MB. This is a
  deploy note, not code.
- Native GATEWAY sessions must be unaffected — the shared `serveGuacTunnel` keeps
  its guacd path; only the `navigateUrl != ""` branch is removed.

## Testing / verification

- `pnpm build` green (no dangling `isolationHiFi` references in manager code).
- `go build ./... && go test ./...` green (no `openBrowserSession`/`isoGuard`/
  `jsonQuote`/`NavigateUrl`/`BrowserControlAddr` references remain); `repair.test.ts`
  updated.
- Residue check: `grep -rn 'isolationHiFi\|captivo-browser\|isolated\.go\|ISOLATED_BROWSER\|openBrowserSession' src dataplane prisma deploy docs/install.md .github kasm-browser browser 2>/dev/null` returns nothing (historical `docs/superpowers/*` allowed).
- GATEWAY regression: a native RDP/SSH/VNC descriptor still returns its guacd
  descriptor and `serveGuacTunnel` still bridges it (build-level; live Gate-A by
  operator).
- Hi-fi ISOLATED still works end to end (transport/clipboard/recording) — unchanged
  code paths, confirmed by the existing B Gate-A.

## Deployment (SEPARATE GATE — explicit user approval required)

Target **v0.65.0**. Schema drop, so:
1. Tag/push → CI builds images (now WITHOUT `captivo-access-browser`).
2. Bump `access-manager` + `access-dataplane` (migrate image no longer needed for
   the standard run) to `0.65.0`; `docker compose pull`.
3. Apply the column drop once: `docker compose run --rm access-migrate` will refuse
   the destructive diff, so run a one-off
   `… prisma db push --accept-data-loss` against the prod DB (per
   `reference_captivo_access_migrate_dataloss`).
4. `up -d access-manager access-dataplane`; verify `/login` 200 + `APP_VERSION`.
5. Gateway host: connector Update (no longer bundles captivo-browser); operator
   `docker rm -f captivo-browser` to reclaim disk.
6. English `gh release edit` note. No Claude signature.

## Global constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Do not break the native GATEWAY path or the transparent proxy.
- Deploy requires explicit user approval; every tag gets an English user-focused
  `gh release edit` note.
- Success = repo grep for `isolationHiFi` / `captivo-browser` / `isolated.go` /
  `ISOLATED_BROWSER` clean outside historical `docs/superpowers/*`.
