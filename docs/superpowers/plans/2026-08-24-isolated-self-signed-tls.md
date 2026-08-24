# Isolated Browser — Self-Signed TLS Targets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an isolated-browser Resource open an HTTPS target with a self-signed / internal-CA certificate, by wiring the existing `Site.insecureSkipVerify` flag through the isolated pipeline into a Chromium `--ignore-certificate-errors` flag.

**Architecture:** The existing `insecureSkipVerify` boolean flows site form → validate → DB → gateway descriptor → data-plane (`kasmtunnel.go`) → broker (`control.py`) → Chromium launch. Default `false` keeps current behaviour. Also fixes a cosmetic BrokenPipe traceback in the broker.

**Tech Stack:** Next.js 16 (App Router), Prisma, Go (data-plane), Python (kasm-browser broker), Vitest.

## Global Constraints

- **English only** — code, comments, UI strings, commit messages, release notes.
- **No Claude signature** in commits.
- **No schema change** — reuse the existing `Site.insecureSkipVerify` column.
- Default **`false`**: only a Resource whose operator explicitly enables it skips verification. Every existing Resource keeps verifying certs.
- Blanket `--ignore-certificate-errors` on the isolated session (not SPKI pinning) — the session navigates to exactly one target, is throwaway and server-side.
- The broker (`kasm-browser`) change is **connector-side**: it takes effect only after the operator updates the connector (Re-pair / Update re-pulls `captivo-access-kasm-browser:latest`).
- Do NOT deploy or write release notes without explicit user approval.

---

### Task 1: Persist `insecureSkipVerify` for ISOLATED Resources

**Files:**
- Modify: `src/lib/site/validate.ts`
- Modify: `src/app/api/admin/sites/route.ts`
- Modify: `src/app/api/admin/sites/[id]/route.ts`
- Test: `src/lib/site/validate.test.ts` (if present; else rely on build)

**Interfaces:**
- Produces: the ISOLATED validated variant gains `insecureSkipVerify: boolean`, consumed by the create/update routes (this task) and available to the descriptor (Task 2 reads it from the DB).

- [ ] **Step 1: Add the field to the ISOLATED variant type + parser.** In `src/lib/site/validate.ts`:
  - Add `insecureSkipVerify: boolean;` to the `mode: "ISOLATED"` variant type (around line 37).
  - In the `if (mode === "ISOLATED")` return object (around line 76), add
    `insecureSkipVerify: body.insecureSkipVerify === true,`.

- [ ] **Step 2: Persist on create.** In `src/app/api/admin/sites/route.ts`, in the `v.mode === "ISOLATED"` create data (around line 62), add `insecureSkipVerify: v.insecureSkipVerify,`.

- [ ] **Step 3: Persist on update.** In `src/app/api/admin/sites/[id]/route.ts`, in the `v.mode === "ISOLATED"` update data (around line 59), add `insecureSkipVerify: v.insecureSkipVerify,`.

- [ ] **Step 4: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/site/validate.ts src/app/api/admin/sites/route.ts "src/app/api/admin/sites/[id]/route.ts"
git commit -m "feat(isolated): persist insecureSkipVerify for isolated resources"
```

---

### Task 2: Return `insecureSkipVerify` from the descriptor (ISOLATED)

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`

**Interfaces:**
- Consumes: `Site.insecureSkipVerify` from the DB (persisted in Task 1).
- Produces: the ISOLATED descriptor JSON gains `insecureSkipVerify: boolean`, consumed by the data-plane (Task 4).

- [ ] **Step 1: Select the field.** In the `db.site.findUnique` `select` (line 31), add `insecureSkipVerify: true`.

- [ ] **Step 2: Return it in the ISOLATED response.** In the `site.accessMode === "ISOLATED"` response object, add `insecureSkipVerify: site.insecureSkipVerify,`.

- [ ] **Step 3: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/internal/gateway/descriptor/route.ts
git commit -m "feat(isolated): return insecureSkipVerify in the isolated descriptor"
```

---

### Task 3: Isolated site-form checkbox

**Files:**
- Modify: `src/app/(app)/admin/sites/site-form.tsx`

**Interfaces:**
- Consumes: the existing `insecureSkipVerify` state (already in the form, already in the submit payload). Purely additive rendering in the ISOLATED block.

- [ ] **Step 1: Render the checkbox in the ISOLATED block.** Inside the `accessMode === "ISOLATED"` block (around line 296-389), add a checkbox bound to the existing `insecureSkipVerify` / `setInsecureSkipVerify` state, mirroring the TRANSPARENT one (line ~390-401) but with isolated wording:

```tsx
        <div className="field">
          <label className="field-label">
            <input
              type="checkbox"
              checked={insecureSkipVerify}
              onChange={(e) => setInsecureSkipVerify(e.target.checked)}
            />{" "}
            Allow self-signed certificate (skip TLS verification)
          </label>
          <span className="hint">
            Only for internal devices you trust — the isolated browser won&apos;t verify the target&apos;s certificate. Needed for self-signed targets like Proxmox, iDRAC/iLO, or router panels.
          </span>
        </div>
```

(Match the file's exact field markup; the wording above is the intended copy.)

- [ ] **Step 2: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add "src/app/(app)/admin/sites/site-form.tsx"
git commit -m "feat(isolated): expose self-signed-certificate toggle on the isolated form"
```

---

### Task 4: Forward `insecure` through the data-plane to the broker

**Files:**
- Modify: `dataplane/kasmtunnel.go`

**Interfaces:**
- Consumes: `insecureSkipVerify` from the descriptor (Task 2).
- Produces: the broker `POST /session` body gains `"insecure": bool`, consumed by the broker (Task 5).

- [ ] **Step 1: Add the descriptor field.** In the `kasmDesc` struct, add:

```go
	InsecureSkipVerify bool `json:"insecureSkipVerify"`
```

- [ ] **Step 2: Thread it into `openKasmSession`.** Add an `insecure bool` parameter to `openKasmSession(...)` and append it to the JSON body:

```go
		`,"watermarkText":` + jsonQuoteKasm(watermarkText) +
		`,"insecure":` + strconv.FormatBool(insecure) + `}`
```

- [ ] **Step 3: Pass it at the call site.** In `serveKasmTunnel`, where `openKasmSession` is called, pass `d.InsecureSkipVerify` as the new argument.

- [ ] **Step 4: Build + gofmt.**

Run: `cd dataplane && gofmt -w kasmtunnel.go && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add dataplane/kasmtunnel.go
git commit -m "feat(isolated): forward insecure flag to the broker session request"
```

---

### Task 5: Broker — Chromium cert flag + BrokenPipe cleanup

**Files:**
- Modify: `kasm-browser/control.py`

**Interfaces:**
- Consumes: `insecure` from the `POST /session` body (Task 4).

- [ ] **Step 1: Read `insecure` in `do_POST`.** In the `/session` handler (after `wtext` is resolved, around line 366), add:

```python
            insecure = bool(data.get("insecure", False))
```

and pass it into `open_session(url, copy_out, paste_in, w, h, wtext, insecure)`.

- [ ] **Step 2: Thread through `open_session` + `_spawn`.**
  - `def open_session(url, copy_out, paste_in, w=1280, h=800, watermark_text="", insecure=False):` — pass `insecure` into the `_spawn(...)` call.
  - `def _spawn(display, url, profile, home, copy_out, paste_in, w=1280, h=800, watermark_text="", insecure=False):`.

- [ ] **Step 3: Add the Chromium flag when insecure.** In `_spawn`, build the Chromium args so that when `insecure` is true, `--ignore-certificate-errors` is included before `url`:

```python
    chrome_args = [CHROME, "--kiosk", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
                   "--no-first-run", "--no-default-browser-check", "--disable-translate",
                   "--user-data-dir=" + profile]
    if insecure:
        chrome_args.append("--ignore-certificate-errors")
    chrome_args.append(url)
    chrome = subprocess.Popen(chrome_args, env=env)
```

- [ ] **Step 4: Swallow BrokenPipe in `_json`.** Wrap the response write so a closed relay doesn't raise a socketserver traceback:

```python
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the data-plane closed the relay before reading the reply
```

- [ ] **Step 5: Syntax check.**

Run: `python3 -m py_compile kasm-browser/control.py`
Expected: no output (success).

- [ ] **Step 6: Commit.**

```bash
git add kasm-browser/control.py
git commit -m "feat(isolated): honor insecure flag in Chromium + swallow close-race BrokenPipe"
```

---

## Deploy (SEPARATE — needs explicit user approval, do not run as part of implementation)

- Manager (validate/routes/descriptor/form) + data-plane (kasmtunnel) + kasm-browser (broker) images build on the release tag.
- Bump prod compose manager + data-plane (+ migrate for tag discipline). The broker change is connector-side: the operator must **Re-pair / Update** the connector to re-pull `captivo-access-kasm-browser:latest`.
- Smoke: an ISOLATED Resource pointed at a self-signed HTTPS target (e.g. Proxmox), with the new checkbox on, opens without the `net_error -202` flood; with it off, the cert is still rejected.
- English user-facing release note.

## Self-Review

- **Spec coverage:** persist (T1), descriptor (T2), UI (T3), data-plane (T4), broker flag + BrokenPipe (T5). All spec sections mapped.
- **Placeholder scan:** none — every step has concrete code. UI/broker snippets note "match the file's exact markup" for surrounding style only; the intended content is given.
- **Type/name consistency:** `insecureSkipVerify` (TS) → descriptor JSON `insecureSkipVerify` → Go `kasmDesc.InsecureSkipVerify` / body key `"insecure"` → Python `data.get("insecure")`. The JSON body key is deliberately `"insecure"` (matches existing broker body style); the descriptor→data-plane field is `insecureSkipVerify`. Both names are used consistently at their layer.
- **Default off:** `body.insecureSkipVerify === true` (T1), `data.get("insecure", False)` (T5) — both default false.
