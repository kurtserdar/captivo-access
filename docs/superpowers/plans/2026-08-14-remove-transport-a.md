# Remove RBI Transport A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline execution — subagent quota is full). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the VNC-via-guacd isolated browser (transport A) completely; `ISOLATED` becomes always KasmVNC and `Site.isolationHiFi` is dropped, leaving no residue.

**Architecture:** A deletion/cleanup slice. Remove A's data-plane code (isolated.go, the guactunnel A-branch, the controlclient descriptor fields), collapse the manager's ISOLATED handling to always-KasmVNC, drop the dead column, and stop bundling/building the `captivo-browser` image — without touching the native GATEWAY guacd path or the transparent proxy.

**Tech Stack:** Go (data-plane), Next.js/Prisma (manager), Docker (image/bundle), GitHub Actions (publish).

## Global Constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Do NOT break the native GATEWAY path (`serveGuacTunnel` guacd bridge) or the transparent proxy (`browserproxy.go`).
- Remove code references BEFORE dropping the schema column (so `db:generate` never leaves dangling references).
- Success = repo grep for `isolationHiFi` / `captivo-browser` / `isolated.go` / `ISOLATED_BROWSER` / `openBrowserSession` clean outside historical `docs/superpowers/*`.
- Deploy is a SEPARATE gate requiring explicit user approval — do NOT auto-run. Target v0.65.0 (column drop → one-off `prisma db push --accept-data-loss`).

---

### Task 1: Data-plane — delete transport A

**Files:**
- Delete: `dataplane/isolated.go`, `dataplane/isolated_test.go`
- Modify: `dataplane/guactunnel.go`, `dataplane/controlclient.go`

**Interfaces:**
- Produces: `GatewayDescriptor(userID, siteID) (GuacConn, string, string, bool, error)` — the `navigateUrl` / `browserControlAddr` return values are gone.

- [ ] **Step 1: Delete the A files**

```bash
cd /opt/captivo-access && git rm dataplane/isolated.go dataplane/isolated_test.go
```

- [ ] **Step 2: Remove the A-ISOLATED block from `guactunnel.go`**

Delete the entire `if navigateUrl != "" { … }` block (from `if navigateUrl != "" { // ISOLATED: ask the broker…` through its closing `}` including the `defer func(){ … buildCloseRequest … }()`). And change the descriptor call line:

```go
	conn, guacdAddr, connectorID, record, err := ctrl.GatewayDescriptor(userID, siteID)
```

(was `…, record, navigateUrl, browserControlAddr, err :=`). Everything from
`guac, err := dialGuacd(sess, guacdAddr)` onward (the GATEWAY bridge + recording)
stays unchanged.

- [ ] **Step 3: Remove the fields from `controlclient.go` GatewayDescriptor**

In the `GatewayDescriptor` method:
- Change the return signature from `(GuacConn, string, string, bool, string, string, error)` to `(GuacConn, string, string, bool, error)`.
- Delete `NavigateUrl` and `BrowserControlAddr` from the `out` struct.
- Change the error return `return GuacConn{}, "", "", false, "", "", err` to `return GuacConn{}, "", "", false, err`.
- Change the success return tail `}, out.GuacdAddress, out.ConnectorID, out.Record, out.NavigateUrl, out.BrowserControlAddr, nil` to `}, out.GuacdAddress, out.ConnectorID, out.Record, nil`.

- [ ] **Step 4: Build — fix any now-unused imports**

Run: `cd /opt/captivo-access/dataplane && go build ./... 2>&1 | head`
Expected: compile errors only for now-unused imports (e.g. `strconv` in guactunnel.go if the A-block was its only user). Remove each unused import the compiler names, then rebuild until clean.

- [ ] **Step 5: Verify no other caller of the changed signature + tests pass**

Run:
```
cd /opt/captivo-access/dataplane && grep -rn 'GatewayDescriptor' *.go
go build ./... && go test ./... 2>&1 | tail -5
grep -n 'openBrowserSession\|isoGuard\|jsonQuote\|NavigateUrl\|BrowserControlAddr\|navigateUrl\|browserControlAddr' *.go || echo "clean"
```
Expected: the only `GatewayDescriptor` call is in `guactunnel.go` (already updated); build + tests PASS; `clean` (no A references left in the data-plane).

- [ ] **Step 6: Commit**

```bash
git add -A dataplane/
git commit -m "refactor(rbi): remove transport A from the data-plane"
```

---

### Task 2: Manager — descriptor ISOLATED always KasmVNC

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`

**Interfaces:**
- Consumes: the kasm descriptor branch (already present) becomes the only ISOLATED response.

- [ ] **Step 1: Collapse the ISOLATED branch to the kasm descriptor**

Replace the whole `if (site.accessMode === "ISOLATED") { … }` body so it always
returns the kasm descriptor (delete the `if (site.isolationHiFi)` wrapper and the
standard-VNC `return NextResponse.json({ protocol: "vnc", … browserControlAddr … })`
block):

```ts
  if (site.accessMode === "ISOLATED") {
    if (!isolationEnabled()) return NextResponse.json({ error: "isolation_disabled" }, { status: 404 });
    return NextResponse.json({
      transport: "kasm",
      navigateUrl: site.upstreamUrl ?? "",
      kasmAddr: (process.env.ISOLATED_KASM_ADDR ?? "captivo-kasm:6901").trim(),
      kasmControlAddr: (process.env.ISOLATED_KASM_CONTROL_ADDR ?? "captivo-kasm:7900").trim(),
      connectorId: site.connectorId,
      clipboardMode: site.clipboardMode,
      record: recordingEnabled() && site.recordSessions,
    });
  }
```

- [ ] **Step 2: Remove `isolationHiFi` from the select**

In the `db.site.findUnique({ … select: { … } })`, delete `isolationHiFi: true,`.

- [ ] **Step 3: Check for now-unused imports**

If `toGuacParams`/`parseGuacParams`/`resolveGuacParams`/`resolvedGuacParamDefaults`
are no longer used by the ISOLATED branch, they are still used by the GATEWAY branch
(vault credential path) — leave them. Only remove an import the build flags as
unused. (Typecheck in Step 4 catches this.)

- [ ] **Step 4: Typecheck**

Run: `cd /opt/captivo-access && pnpm build > /tmp/ra-t2.log 2>&1; echo "exit=$?"; tail -3 /tmp/ra-t2.log`
Expected: `exit=0`. (The Prisma client still has `isolationHiFi` at this point, so no dangling-field error; the column is dropped in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/internal/gateway/descriptor/route.ts
git commit -m "refactor(rbi): ISOLATED descriptor is always KasmVNC"
```

---

### Task 3: Manager — remove isolationHiFi from forms, validation, session page

**Files:**
- Modify: `src/app/(app)/admin/sites/site-form.tsx`
- Modify: `src/lib/site/validate.ts`, `src/lib/site/validate.test.ts`
- Modify: `src/app/api/admin/sites/route.ts`, `src/app/api/admin/sites/[id]/route.ts`
- Modify: `src/app/(app)/admin/sites/[id]/edit/page.tsx`
- Modify: `src/app/gateway/[siteId]/session/page.tsx`

**Interfaces:**
- Consumes: the ISOLATED site shape no longer carries `isolationHiFi`.

- [ ] **Step 1: site-form.tsx — remove the Streaming quality select + state**

Delete the `<select id="site-iso-fidelity" …>` "Streaming quality: Standard / High-fidelity" control and its label wrapper; delete the `isolationHiFi` `useState`; delete `isolationHiFi` from `SiteInitial` and from the submit body. Keep the Clipboard (B2) and Record (B3) controls.

- [ ] **Step 2: validate.ts + validate.test.ts — drop the field**

In `validate.ts`, remove `isolationHiFi: boolean;` from the ISOLATED success variant type and the `isolationHiFi: body.isolationHiFi === true` assignment in the ISOLATED branch. In `validate.test.ts`, remove any assertion that expects `isolationHiFi` on the ISOLATED result.

- [ ] **Step 3: sites routes — drop from create/update data**

In `src/app/api/admin/sites/route.ts` and `src/app/api/admin/sites/[id]/route.ts`, remove `isolationHiFi: v.isolationHiFi` from the ISOLATED create/update `data`.

- [ ] **Step 4: edit page — drop from select + props**

In `src/app/(app)/admin/sites/[id]/edit/page.tsx`, remove `isolationHiFi: true` from the `db.site.findUnique` select and `isolationHiFi: site.isolationHiFi` from the `<SiteForm site={{…}} />` props.

- [ ] **Step 5: session page — ISOLATED always the kasm iframe**

In `src/app/gateway/[siteId]/session/page.tsx`: change
`if (site.accessMode === "ISOLATED" && site.isolationHiFi)` to
`if (site.accessMode === "ISOLATED")`, and remove `isolationHiFi: true` from the
`db.site.findUnique` select. The `GatewaySession`/consent fallback below stays for
GATEWAY only.

- [ ] **Step 6: Typecheck + site tests**

Run:
```
cd /opt/captivo-access && pnpm build > /tmp/ra-t3.log 2>&1; echo "exit=$?"; tail -3 /tmp/ra-t3.log
npx vitest run src/lib/site/validate.test.ts 2>&1 | tail -4
```
Expected: build `exit=0`; validate tests PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/admin/sites/site-form.tsx" src/lib/site/validate.ts src/lib/site/validate.test.ts "src/app/api/admin/sites/route.ts" "src/app/api/admin/sites/[id]/route.ts" "src/app/(app)/admin/sites/[id]/edit/page.tsx" "src/app/gateway/[siteId]/session/page.tsx"
git commit -m "refactor(rbi): drop the isolationHiFi transport selector from the UI + API"
```

---

### Task 4: Schema — drop the isolationHiFi column

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Site` model without `isolationHiFi`. (DB `db push --accept-data-loss` happens at deploy, not here.)

- [ ] **Step 1: Remove the column**

In `model Site`, delete the `isolationHiFi Boolean @default(false)` line.

- [ ] **Step 2: Regenerate the client + full grep for stragglers**

Run:
```
cd /opt/captivo-access && pnpm db:generate 2>&1 | tail -3
grep -rn 'isolationHiFi' src prisma --include=*.ts --include=*.tsx --include=*.prisma | grep -v 'src/generated'
```
Expected: client generates; the grep (excluding the freshly-regenerated `src/generated`) returns nothing. If any non-generated reference remains, remove it and re-run.

- [ ] **Step 3: Typecheck (client no longer has the field)**

Run: `cd /opt/captivo-access && pnpm build > /tmp/ra-t4.log 2>&1; echo "exit=$?"; tail -3 /tmp/ra-t4.log`
Expected: `exit=0` (no code references the dropped field).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma
git commit -m "refactor(rbi): drop the dead Site.isolationHiFi column"
```

---

### Task 5: Bundle, image, CI, docs — stop shipping captivo-browser

**Files:**
- Modify: `src/lib/connector/repair.ts`, `src/lib/connector/repair.test.ts`
- Delete: `browser/` directory
- Modify: `.github/workflows/publish.yml`
- Modify: `docs/install.md`

**Interfaces:**
- Produces: `runCommand` no longer bundles `captivo-browser`; CI no longer builds `captivo-access-browser`.

- [ ] **Step 1: repair.ts — remove the browser bundle block**

In `runCommand`, delete the `browser` service block (the
`docker pull ghcr.io/kurtserdar/captivo-access-browser:latest; docker rm -f captivo-browser …; docker run -d --name captivo-browser … captivo-access-browser:latest;` lines and the `BROWSER` const). Keep the guacd, connector, and kasm blocks intact.

- [ ] **Step 2: repair.test.ts — drop the browser assertion**

Remove the test assertion `expect(...).toContain("docker pull ghcr.io/kurtserdar/captivo-access-browser:latest")` (and any `--name captivo-browser` assertion). Keep the kasm assertion (`captivo-access-kasm-browser`).

- [ ] **Step 3: Delete the A image source**

```bash
cd /opt/captivo-access && git rm -r browser/
```

- [ ] **Step 4: publish.yml — remove the browser image**

In `.github/workflows/publish.yml`, delete the matrix entry that builds
`captivo-access-browser` from `browser/Dockerfile` (keep `kasm-browser`, manager,
dataplane, connector, migrate, guacd if listed).

- [ ] **Step 5: docs/install.md — remove standard-isolated references**

Remove any lines mentioning the standard isolated browser, `captivo-browser`, or
`ISOLATED_BROWSER_ADDR` / `ISOLATED_BROWSER_CONTROL_ADDR`. Keep the high-fidelity
(KasmVNC) isolated-browser docs.

- [ ] **Step 6: Verify manager build + repair tests**

Run:
```
cd /opt/captivo-access && pnpm build > /tmp/ra-t5.log 2>&1; echo "exit=$?"; tail -2 /tmp/ra-t5.log
npx vitest run src/lib/connector/repair.test.ts 2>&1 | tail -4
```
Expected: build `exit=0`; repair tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(rbi): stop bundling/building the transport-A browser image"
```

---

### Task 6: Full verification — no residue, nothing else broken

**Files:** none (verification only)

- [ ] **Step 1: Manager build + Go build/test**

Run:
```
cd /opt/captivo-access && pnpm build > /tmp/ra-v.log 2>&1; echo "mgr=$?"; tail -2 /tmp/ra-v.log
cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -3
```
Expected: mgr `exit=0`; Go PASS.

- [ ] **Step 2: Residue grep (must be clean outside historical specs/plans)**

Run:
```
cd /opt/captivo-access && grep -rn 'isolationHiFi\|captivo-browser\|isolated\.go\|ISOLATED_BROWSER\|openBrowserSession\|buildNavigateRequest' src dataplane prisma deploy docs/install.md .github kasm-browser 2>/dev/null | grep -v 'src/generated'
```
Expected: NOTHING. (Historical `docs/superpowers/*` and `docs/captivo-access/*` are allowed to keep the old names.)

- [ ] **Step 3: Confirm the KEEP surfaces are intact**

Run:
```
cd /opt/captivo-access && ls kasm-browser/ && grep -c 'BrowserProxy' dataplane/browserproxy.go && grep -c 'dialGuacd(sess, guacdAddr)' dataplane/guactunnel.go
```
Expected: `kasm-browser/` still present; `browserproxy.go` intact; guactunnel still dials guacd for the GATEWAY path (count ≥ 1).

- [ ] **Step 4: Commit (only if a straggler fix was needed)**

```bash
git add -A && git commit -m "refactor(rbi): remove final transport-A straggler"
```

---

## Deployment (SEPARATE GATE — explicit user approval required, do NOT auto-run)

Target **v0.65.0** — schema drop is destructive, so it needs a one-off override.

1. `git push origin main` + `git tag v0.65.0 && git push origin v0.65.0`; watch `publish.yml` green (it now builds one fewer image — no `captivo-access-browser`).
2. In `/opt/captivo-access-prod/docker-compose.yml`, bump `access-manager` + `access-dataplane` + `access-migrate` to `0.65.0`; `docker compose pull access-manager access-dataplane access-migrate`.
3. Drop the column once (destructive — the standard `access-migrate` run refuses it):
   ```
   cd /opt/captivo-access/packages... # N/A here; run prisma from the migrate image:
   docker compose run --rm --entrypoint sh access-migrate -c "npx prisma db push --accept-data-loss"
   ```
   (per `reference_captivo_access_migrate_dataloss`; prod DB reachable as the migrate service configures — IPv4). Confirm it reports the schema in sync.
4. `docker compose up -d access-manager access-dataplane`; verify `/login` 200 + `APP_VERSION` → 0.65.0.
5. Gateway host: run the connector Update (it no longer bundles `captivo-browser`); then reclaim disk: `docker rm -f captivo-browser` (~343 MB). guacd/kasm/connector unaffected.
6. `gh release edit v0.65.0 --notes "<English, user-focused>"`. No Claude signature.

**Gate-A (operator):** a hi-fi ISOLATED site still opens/records/clipboard-gates (unchanged B); a native GATEWAY (RDP/SSH) session still connects (shared guactunnel path preserved); no ISOLATED site offers a Standard/High-fidelity choice anymore.

---

## Self-Review

**Spec coverage:** delete isolated.go+test + guactunnel A-block + controlclient fields (Task 1) ✓; descriptor ISOLATED→always kasm (Task 2) ✓; site-form/validate/routes/edit/session-page isolationHiFi removal (Task 3) ✓; drop the column (Task 4) ✓; repair.ts + browser/ + publish.yml + install.md (Task 5) ✓; residue grep + KEEP checks + GATEWAY intact (Task 6) ✓; deploy with `--accept-data-loss` + operator `docker rm -f captivo-browser` (Deployment) ✓.

**Placeholder scan:** none — every step is a concrete edit/command; the one conditional (Task 6 Step 4) is a real branch.

**Type consistency:** `GatewayDescriptor` new signature `(GuacConn, string, string, bool, error)` used identically in the controlclient returns and the guactunnel call site; the descriptor kasm response shape matches `kasmDesc` already in the data-plane; `isolationHiFi` removed from every layer (select, type, assignment, data, props, conditional) before the column drop so `db:generate` leaves no dangling reference. Ordering (code refs removed in Tasks 1–3 before the schema drop in Task 4) prevents a regenerate-time break.
