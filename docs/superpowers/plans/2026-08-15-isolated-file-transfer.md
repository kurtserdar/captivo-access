# Isolated Browser File Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional file transfer (vendor ⇄ isolated Chromium) to ISOLATED sessions, governed by a per-site DLP mode, defaulting off.

**Architecture:** File transfer flows through the outer React session page → manager API → dataplane internal API `/kasm-files` → (connector control relay) → broker HTTP endpoints in `control.py`, which read/write the session's home directory. The dataplane resolves the target session from the session hub by (userId, siteId) and enforces the DLP mode there. No change to the KasmVNC iframe/RFB stream.

**Tech Stack:** Next.js (manager, TypeScript), Go (dataplane), Python `http.server` (kasm broker), Prisma/Postgres, vitest (TS tests), `go test` (Go tests), pytest-style (broker test).

## Global Constraints

- **Language:** English only — all code comments, identifiers, UI strings, commit messages. (captivo-access is a public repo.)
- **No Claude signature** in commits or PR bodies.
- **DB model:** `prisma db push` (no migrations directory). Adding a defaulted column is non-destructive — no `--accept-data-loss`. Prod DB is `127.0.0.1:5434` (IPv4).
- **DLP mode values:** `allow | no_upload | no_download | none`. Default `none`.
- **DLP direction mapping (use verbatim everywhere):** `allow`→(upload ✓, download ✓); `no_upload`→(upload ✗, download ✓); `no_download`→(upload ✓, download ✗); `none`/unknown→(upload ✗, download ✗).
- **Size cap:** 100 MB per file per direction. Env override `ISOLATED_FT_MAX_BYTES` (bytes) on both manager and broker; default `104857600`.
- **Deploy + release notes are SEPARATE standing gates** — do NOT run `deploy/setup.sh`, docker builds, git tags, or `gh release` steps. Stop when code is committed and building/tests green; wait for explicit user approval to deploy.
- **Broker file dirs:** uploads → session HOME root `/sess/<sid>/`; downloads → `/sess/<sid>/Downloads/`. Both wiped by existing `_kill` rmtree on session close.

---

## File Structure

**Schema / validation (Task 1)**
- Modify: `prisma/schema.prisma` — add `Site.fileTransferMode`
- Modify: `src/lib/site/validate.ts` — add `FT` enum, thread `fileTransferMode` through the ISOLATED branch + its type
- Modify: `src/lib/site/validate.test.ts` — add cases

**Admin UI + persistence (Task 2)**
- Modify: `src/app/(app)/admin/sites/site-form.tsx` — `fileTransferMode` select in the ISOLATED block
- Modify: `src/app/api/admin/sites/route.ts` — persist on create
- Modify: `src/app/api/admin/sites/[id]/route.ts` — persist on update

**Descriptor threading (Task 3)**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts` — select + return `fileTransferMode`
- Modify: `dataplane/kasmtunnel.go` — add `FileTransferMode` to `kasmDesc`

**Hub storage + DLP helper (Task 4)**
- Modify: `dataplane/sessionhub.go` — add fields to `liveSession`, grow `RegisterIsolated`, add `IsolatedFileTarget` lookup
- Create: `dataplane/kasmfiles.go` — `fileTransferAllows` helper lives here (used by Task 6); this task adds only the helper + its test
- Modify: `dataplane/kasmtunnel.go` — pass new args to `RegisterIsolated`
- Modify: `dataplane/sessionhub_test.go` — update existing call, add lookup test
- Create: `dataplane/kasmfiles_test.go` — `fileTransferAllows` table test

**Broker endpoints (Task 5)**
- Modify: `kasm-browser/control.py` — `_safe_name`, ensure Downloads dir, 3 endpoints
- Create: `kasm-browser/control_test.py` — `_safe_name` tests

**Dataplane handler (Task 6)**
- Modify: `dataplane/kasmfiles.go` — `serveKasmFiles` (relay + DLP + audit)
- Modify: `dataplane/main.go` — move `audit` creation above the internal mux; register `/kasm-files`

**Manager API + client (Task 7)**
- Modify: `src/lib/dataplane/client.ts` — 3 helper functions
- Create: `src/app/api/isolated/files/upload/route.ts`
- Create: `src/app/api/isolated/files/downloads/route.ts`
- Create: `src/app/api/isolated/files/download/route.ts`

**Session UI (Task 8)**
- Modify: `src/app/gateway/[siteId]/session/page.tsx` — pass `fileTransferMode` to `IsolatedSession`
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx` — upload button + download tray

---

### Task 1: Schema + validation

**Files:**
- Modify: `prisma/schema.prisma` (Site model, near `clipboardMode` line 155)
- Modify: `src/lib/site/validate.ts`
- Test: `src/lib/site/validate.test.ts`

**Interfaces:**
- Produces: `SiteValidation` ISOLATED variant gains `fileTransferMode: string`. Validation normalizes any invalid/absent value to `"none"`.

- [ ] **Step 1: Add the schema field**

In `prisma/schema.prisma`, in the `Site` model right after the `clipboardMode` line, add:

```prisma
  fileTransferMode   String        @default("none") // allow | no_upload | no_download | none (ISOLATED only)
```

- [ ] **Step 2: Push the schema + regenerate client**

Run:
```bash
cd /opt/captivo-access && npx prisma db push && npx prisma generate
```
Expected: "Your database is now in sync" + client generated. (Non-destructive: defaulted column.)

- [ ] **Step 3: Write the failing validation test**

In `src/lib/site/validate.test.ts`, add (adapt the existing helper that builds an ISOLATED body + `opts`; match the file's existing style):

```ts
it("defaults ISOLATED fileTransferMode to none when absent", () => {
  const r = validateSiteInput(
    { accessMode: "ISOLATED", connectorId: "c1", name: "n", upstreamUrl: "https://x.test" },
    { nativeGateway: true, requireSecret: false, recordingEnabled: true, isolationEnabled: true },
  );
  expect(r.ok).toBe(true);
  if (r.ok && r.mode === "ISOLATED") expect(r.fileTransferMode).toBe("none");
});

it("accepts a valid ISOLATED fileTransferMode", () => {
  const r = validateSiteInput(
    { accessMode: "ISOLATED", connectorId: "c1", name: "n", upstreamUrl: "https://x.test", fileTransferMode: "no_download" },
    { nativeGateway: true, requireSecret: false, recordingEnabled: true, isolationEnabled: true },
  );
  expect(r.ok && r.mode === "ISOLATED" && r.fileTransferMode).toBe("no_download");
});

it("normalizes an invalid ISOLATED fileTransferMode to none", () => {
  const r = validateSiteInput(
    { accessMode: "ISOLATED", connectorId: "c1", name: "n", upstreamUrl: "https://x.test", fileTransferMode: "bogus" },
    { nativeGateway: true, requireSecret: false, recordingEnabled: true, isolationEnabled: true },
  );
  expect(r.ok && r.mode === "ISOLATED" && r.fileTransferMode).toBe("none");
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `npx vitest run src/lib/site/validate.test.ts`
Expected: FAIL (`fileTransferMode` undefined on the result).

- [ ] **Step 5: Implement the validation**

In `src/lib/site/validate.ts`:

1. Below the `CLIP` const (line 3) add:
```ts
const FT = ["allow", "no_upload", "no_download", "none"];
```
2. In the ISOLATED variant of the `SiteValidation` type (the `mode: "ISOLATED"` object, near line 42) add:
```ts
      fileTransferMode: string;
```
3. In the ISOLATED branch return (near line 71), add the field after `clipboardMode`:
```ts
      fileTransferMode: (() => { const f = str(body.fileTransferMode); return FT.includes(f) ? f : "none"; })(),
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx vitest run src/lib/site/validate.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/site/validate.ts src/lib/site/validate.test.ts src/generated 2>/dev/null; git add prisma/schema.prisma src/lib/site/validate.ts src/lib/site/validate.test.ts
git commit -m "feat(isolated): add per-site fileTransferMode (schema + validation)"
```
(`src/generated/prisma` is gitignored/legacy-tracked; if `git add` refuses it, ignore — Docker regenerates.)

---

### Task 2: Site form + persistence

**Files:**
- Modify: `src/app/(app)/admin/sites/site-form.tsx`
- Modify: `src/app/api/admin/sites/route.ts` (create)
- Modify: `src/app/api/admin/sites/[id]/route.ts` (update)

**Interfaces:**
- Consumes: `validateSiteInput` ISOLATED result now carries `fileTransferMode` (Task 1).
- Produces: ISOLATED sites persist `fileTransferMode`; the edit form shows + submits it.

- [ ] **Step 1: Add form state + type**

In `src/app/(app)/admin/sites/site-form.tsx`:
1. In the `site` prop type (near line 47, after `watermark?`), add:
```ts
  fileTransferMode?: string;
```
2. Near the other `useState` (after the `watermark` state, ~line 86) add:
```ts
  const [fileTransferMode, setFileTransferMode] = useState(site?.fileTransferMode ?? "none");
```
3. In the submit payload object (where `clipboardMode`/`watermark` are set for ISOLATED, ~line 161), add `fileTransferMode,` to the body. It is harmless for other modes (the server validation only reads it for ISOLATED).

- [ ] **Step 2: Add the select in the ISOLATED block**

In the `accessMode === "ISOLATED"` JSX block (after the watermark select, ~line 322), add:

```tsx
          <div className="field">
            <label className="field-label" htmlFor="site-filetransfer">File transfer</label>
            <select id="site-filetransfer" className="select" value={fileTransferMode} onChange={(e) => setFileTransferMode(e.target.value)}>
              <option value="none">Off (no file transfer)</option>
              <option value="allow">Upload and download</option>
              <option value="no_download">Upload only</option>
              <option value="no_upload">Download only</option>
            </select>
            <p className="field-hint">Move files between the vendor and the isolated browser. Off by default.</p>
          </div>
```
(If `field-hint` is not an existing class in this form, drop the `<p>` or reuse the class the watermark field uses for its hint — match the surrounding markup.)

- [ ] **Step 3: Persist on update**

In `src/app/api/admin/sites/[id]/route.ts`, in the ISOLATED update branch (the `accessMode: "ISOLATED"` `db.site.update` `data`, ~line 59), add after `clipboardMode: v.clipboardMode,`:
```ts
fileTransferMode: v.fileTransferMode,
```

- [ ] **Step 4: Persist on create**

In `src/app/api/admin/sites/route.ts`, in the ISOLATED create `data` (~line 62), add after `clipboardMode: v.clipboardMode,`:
```ts
fileTransferMode: v.fileTransferMode,
```

- [ ] **Step 5: Confirm the ISOLATED site select passes `fileTransferMode` to the form**

Find where `site-form.tsx` is rendered with an existing site (the sites list/edit view, e.g. `src/app/(app)/admin/sites/sites-view.tsx` or `page.tsx`). Ensure the site object handed to the form includes `fileTransferMode` — if it selects explicit columns, add `fileTransferMode: true` to that Prisma `select`; if it passes the whole row, no change needed.

Run:
```bash
cd /opt/captivo-access && grep -rn "fileTransferMode\|clipboardMode" src/app/\(app\)/admin/sites/page.tsx src/app/\(app\)/admin/sites/sites-view.tsx
```
Mirror wherever `clipboardMode` is selected.

- [ ] **Step 6: Typecheck**

Run: `pnpm build`
Expected: "Compiled successfully", no type error. (Guard the check: `pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo OK`.)

- [ ] **Step 7: Commit**

```bash
git add -A src/app
git commit -m "feat(isolated): admin per-site file-transfer setting"
```

---

### Task 3: Descriptor threading

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`
- Modify: `dataplane/kasmtunnel.go` (`kasmDesc` struct)

**Interfaces:**
- Produces: the ISOLATED descriptor JSON gains `fileTransferMode: string`; `kasmDesc.FileTransferMode` receives it. Task 4 reads `d.FileTransferMode`.

- [ ] **Step 1: Select the column**

In `src/app/api/internal/gateway/descriptor/route.ts`, add `fileTransferMode: true` to the `site.findUnique` `select` (line ~30, alongside `clipboardMode: true`).

- [ ] **Step 2: Return it in the ISOLATED descriptor**

In the ISOLATED branch return object (~line 48–56, where `clipboardMode: site.clipboardMode` is set), add:
```ts
      fileTransferMode: site.fileTransferMode,
```

- [ ] **Step 3: Add the Go struct field**

In `dataplane/kasmtunnel.go`, in the `kasmDesc` struct (line ~136, after `ClipboardMode`), add:
```go
	FileTransferMode string `json:"fileTransferMode"`
```

- [ ] **Step 4: Verify both build**

Run:
```bash
cd /opt/captivo-access && pnpm build 2>&1 | tail -3
cd /opt/captivo-access/dataplane && go build ./...
```
Expected: manager compiles; `go build` exits 0.

- [ ] **Step 5: Commit**

```bash
cd /opt/captivo-access
git add src/app/api/internal/gateway/descriptor/route.ts dataplane/kasmtunnel.go
git commit -m "feat(isolated): thread fileTransferMode through the session descriptor"
```

---

### Task 4: Hub storage + DLP helper

**Files:**
- Modify: `dataplane/sessionhub.go`
- Create: `dataplane/kasmfiles.go` (helper only in this task)
- Modify: `dataplane/kasmtunnel.go` (RegisterIsolated call site)
- Test: `dataplane/sessionhub_test.go`, `dataplane/kasmfiles_test.go`

**Interfaces:**
- Consumes: `d.FileTransferMode` (Task 3), broker session `id` + `d.KasmControlAddr` (already in `kasmtunnel.go` scope).
- Produces:
  - `RegisterIsolated(sessionID, siteID, userID, host string, startedAt time.Time, connectorID, kasmAddr string, kasmPort int, brokerSID, kasmControlAddr, fileTransferMode string) *liveSession`
  - `(*SessionHub).IsolatedFileTarget(userID, siteID string) (connectorID, kasmControlAddr, brokerSID, mode, host string, ok bool)`
  - `fileTransferAllows(mode string) (up, down bool)` in `kasmfiles.go`

- [ ] **Step 1: Write the failing DLP-helper test**

Create `dataplane/kasmfiles_test.go`:
```go
package main

import "testing"

func TestFileTransferAllows(t *testing.T) {
	cases := []struct {
		mode           string
		wantUp, wantDn bool
	}{
		{"allow", true, true},
		{"no_upload", false, true},
		{"no_download", true, false},
		{"none", false, false},
		{"", false, false},
		{"bogus", false, false},
	}
	for _, c := range cases {
		up, dn := fileTransferAllows(c.mode)
		if up != c.wantUp || dn != c.wantDn {
			t.Errorf("mode %q: got (%v,%v) want (%v,%v)", c.mode, up, dn, c.wantUp, c.wantDn)
		}
	}
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd /opt/captivo-access/dataplane && go test ./... -run TestFileTransferAllows`
Expected: FAIL (undefined: fileTransferAllows).

- [ ] **Step 3: Create `kasmfiles.go` with the helper**

Create `dataplane/kasmfiles.go`:
```go
package main

// fileTransferAllows maps a site's fileTransferMode to per-direction booleans.
// up = vendor -> isolated (upload); down = isolated -> vendor (download).
// Unknown/empty defaults to denied both ways (isolation-first).
func fileTransferAllows(mode string) (up, down bool) {
	switch mode {
	case "allow":
		return true, true
	case "no_upload":
		return false, true
	case "no_download":
		return true, false
	default: // "none", "", unknown
		return false, false
	}
}
```

- [ ] **Step 4: Run the helper test to confirm it passes**

Run: `cd /opt/captivo-access/dataplane && go test ./... -run TestFileTransferAllows`
Expected: PASS.

- [ ] **Step 5: Extend `liveSession` + `RegisterIsolated`**

In `dataplane/sessionhub.go`:
1. In the `liveSession` struct (after `kasmPort int`, ~line 39) add:
```go
	brokerSID, kasmControlAddr, ftMode string
```
2. Change `RegisterIsolated` (line ~131) signature and body to store them:
```go
func (h *SessionHub) RegisterIsolated(sessionID, siteID, userID, host string, startedAt time.Time, connectorID, kasmAddr string, kasmPort int, brokerSID, kasmControlAddr, fileTransferMode string) *liveSession {
	ls := &liveSession{
		id: sessionID, siteID: siteID, userID: userID, protocol: "isolated", host: host,
		kind:      "isolated",
		startedAt: startedAt, connectorID: connectorID, kasmAddr: kasmAddr, kasmPort: kasmPort,
		brokerSID: brokerSID, kasmControlAddr: kasmControlAddr, ftMode: fileTransferMode,
	}
	h.mu.Lock()
	h.m[sessionID] = ls
	h.mu.Unlock()
	return ls
}
```
3. Add the lookup method (place it after `RegisterIsolated`):
```go
// IsolatedFileTarget finds the caller's active isolated session for a site and
// returns what the file-transfer relay needs. ok=false if none is active.
func (h *SessionHub) IsolatedFileTarget(userID, siteID string) (connectorID, kasmControlAddr, brokerSID, mode, host string, ok bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ls := range h.m {
		if ls.kind == "isolated" && ls.userID == userID && ls.siteID == siteID {
			return ls.connectorID, ls.kasmControlAddr, ls.brokerSID, ls.ftMode, ls.host, true
		}
	}
	return "", "", "", "", "", false
}
```

- [ ] **Step 6: Update the `RegisterIsolated` call site**

In `dataplane/kasmtunnel.go` (the `hub.RegisterIsolated(...)` call, ~line 326), append the three new args:
```go
		hub.RegisterIsolated(sessionID, siteID, userID, d.NavigateUrl, time.Now(), d.ConnectorID, d.KasmAddr, port, id, d.KasmControlAddr, d.FileTransferMode)
```
(`id` is the broker session id returned by `openKasmSession` above.)

- [ ] **Step 7: Fix the existing hub test + add a lookup test**

In `dataplane/sessionhub_test.go`:
1. Update the existing `RegisterIsolated(...)` call (line ~26) to add three trailing args, e.g. `..., 6902, "bsid1", "10.0.0.1:7900", "allow")`.
2. Add:
```go
func TestIsolatedFileTarget(t *testing.T) {
	h := NewSessionHub()
	h.RegisterIsolated("s1", "site1", "user1", "https://x.test", time.Now(), "conn1", "10.0.0.1:6901", 6902, "bsid1", "10.0.0.1:7900", "no_upload")
	conn, ctrl, sid, mode, host, ok := h.IsolatedFileTarget("user1", "site1")
	if !ok || conn != "conn1" || ctrl != "10.0.0.1:7900" || sid != "bsid1" || mode != "no_upload" || host != "https://x.test" {
		t.Fatalf("unexpected: %v %q %q %q %q %q", ok, conn, ctrl, sid, mode, host)
	}
	if _, _, _, _, _, ok := h.IsolatedFileTarget("user1", "other"); ok {
		t.Fatal("expected no match for other site")
	}
}
```

- [ ] **Step 8: Build + run the dataplane tests**

Run:
```bash
cd /opt/captivo-access/dataplane && go build ./... && go test ./... -run 'TestFileTransferAllows|TestIsolatedFileTarget|TestRegisterIsolated'
```
Expected: build ok; all three tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /opt/captivo-access
git add dataplane/sessionhub.go dataplane/kasmfiles.go dataplane/kasmtunnel.go dataplane/sessionhub_test.go dataplane/kasmfiles_test.go
git commit -m "feat(isolated): store file-transfer target in the session hub + DLP helper"
```

---

### Task 5: Broker file-transfer endpoints

**Files:**
- Modify: `kasm-browser/control.py`
- Test: `kasm-browser/control_test.py`

**Interfaces:**
- Produces (broker HTTP, reached only via the connector relay):
  - `POST /session/<sid>/upload` — header `X-Filename`, body = raw bytes → writes `/sess/<sid>/<safe>`; `201 {"ok":true,"name":<safe>}`. `413` over cap, `404` unknown sid, `400` bad name.
  - `GET /session/<sid>/downloads` — `200 [{"name","size","mtime"}]` from `/sess/<sid>/Downloads` (skips `*.crdownload`).
  - `GET /session/<sid>/downloads/<name>` — streams the file; `404` if absent.
  - `_safe_name(name) -> str|None` module function.

- [ ] **Step 1: Ensure the Downloads dir exists at spawn**

In `kasm-browser/control.py`, in `_spawn` after `os.makedirs(home + "/.vnc", exist_ok=True)` (~line 41) add:
```python
    os.makedirs(home + "/Downloads", exist_ok=True)
```

- [ ] **Step 2: Write the failing `_safe_name` test**

Create `kasm-browser/control_test.py`:
```python
import importlib.util, os, sys

spec = importlib.util.spec_from_file_location("control", os.path.join(os.path.dirname(__file__), "control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


def test_safe_name_basename():
    assert control._safe_name("report.pdf") == "report.pdf"
    assert control._safe_name("/a/b/report.pdf") == "report.pdf"


def test_safe_name_rejects_traversal():
    assert control._safe_name("../../etc/passwd") == "passwd"
    assert control._safe_name("..") is None
    assert control._safe_name("") is None
    assert control._safe_name("   ") is None
    assert control._safe_name(".") is None


if __name__ == "__main__":
    test_safe_name_basename()
    test_safe_name_rejects_traversal()
    print("ok")
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd /opt/captivo-access/kasm-browser && python3 control_test.py`
Expected: FAIL (`AttributeError: module 'control' has no attribute '_safe_name'`).

- [ ] **Step 4: Add `_safe_name` + the size cap constant**

In `control.py`, near the top-level constants (after `CHROME = ...`, ~line 10) add:
```python
FT_MAX_BYTES = int(os.environ.get("ISOLATED_FT_MAX_BYTES", str(100 * 1024 * 1024)))
```
And add a module-level helper (place it above the `H` handler class):
```python
def _safe_name(name):
    # Reduce any client-supplied name to a single safe path segment. Returns the
    # basename with directory parts stripped, or None if nothing usable remains.
    if not isinstance(name, str):
        return None
    base = os.path.basename(name.strip().replace("\\", "/"))
    if base in ("", ".", ".."):
        return None
    return base
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd /opt/captivo-access/kasm-browser && python3 control_test.py`
Expected: prints `ok`.

- [ ] **Step 6: Add the download list + download-one GET routes**

In `H.do_GET` (before the `if u.path == "/healthz":` line, ~line 248) add:
```python
        # File transfer: list finished downloads in the session's Downloads dir.
        if u.path.startswith("/session/") and u.path.endswith("/downloads"):
            sid = u.path[len("/session/"):-len("/downloads")]
            with _lock:
                sess = _sessions.get(sid)
                home = sess["home"] if sess else None
            if home is None:
                return self._json(404, {"error": "not_found"})
            ddir = home + "/Downloads"
            out = []
            try:
                for n in os.listdir(ddir):
                    if n.endswith(".crdownload"):
                        continue
                    p = ddir + "/" + n
                    if os.path.isfile(p):
                        out.append({"name": n, "size": os.path.getsize(p), "mtime": int(os.path.getmtime(p))})
            except OSError:
                pass
            return self._json(200, out)
        # File transfer: stream one finished download.
        if u.path.startswith("/session/") and "/downloads/" in u.path:
            head, _, raw = u.path.partition("/downloads/")
            sid = head[len("/session/"):]
            name = _safe_name(urllib.parse.unquote(raw))
            with _lock:
                sess = _sessions.get(sid)
                home = sess["home"] if sess else None
            if home is None or name is None:
                return self._json(404, {"error": "not_found"})
            p = home + "/Downloads/" + name
            if not os.path.isfile(p):
                return self._json(404, {"error": "not_found"})
            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(os.path.getsize(p)))
                self.end_headers()
                with open(p, "rb") as f:
                    while True:
                        buf = f.read(65536)
                        if not buf:
                            break
                        self.wfile.write(buf)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return
```

- [ ] **Step 7: Add the upload POST route**

In `H.do_POST` (before the final `self._json(404, ...)`, after the `/close` block, ~line 279) add:
```python
        if path.startswith("/session/") and path.endswith("/upload"):
            sid = path[len("/session/"):-len("/upload")]
            with _lock:
                sess = _sessions.get(sid)
                home = sess["home"] if sess else None
            if home is None:
                return self._json(404, {"error": "not_found"})
            name = _safe_name(self.headers.get("X-Filename", ""))
            if name is None:
                return self._json(400, {"error": "bad_name"})
            n = int(self.headers.get("Content-Length", "0") or "0")
            if n > FT_MAX_BYTES:
                return self._json(413, {"error": "too_large"})
            dest = home + "/" + name
            remaining = n
            try:
                with open(dest, "wb") as f:
                    while remaining > 0:
                        chunk = self.rfile.read(min(65536, remaining))
                        if not chunk:
                            break
                        f.write(chunk)
                        remaining -= len(chunk)
            except OSError:
                return self._json(500, {"error": "write_failed"})
            return self._json(201, {"ok": True, "name": name})
```

- [ ] **Step 8: Byte-compile check**

Run: `cd /opt/captivo-access/kasm-browser && python3 -c "import py_compile; py_compile.compile('control.py', doraise=True)" && python3 control_test.py`
Expected: no compile error; prints `ok`.

- [ ] **Step 9: Commit**

```bash
cd /opt/captivo-access
git add kasm-browser/control.py kasm-browser/control_test.py
git commit -m "feat(isolated): broker upload/download endpoints"
```

---

### Task 6: Dataplane `/kasm-files` handler

**Files:**
- Modify: `dataplane/kasmfiles.go` (add `serveKasmFiles`)
- Modify: `dataplane/main.go` (move `audit` up; register route)

**Interfaces:**
- Consumes: `hub.IsolatedFileTarget`, `fileTransferAllows` (Task 4); `reg.Get`, `dialGuacd`, `auditEvent`, `AuditQueue.Enqueue` (existing).
- Produces: internal route `POST/GET /kasm-files` (secret-guarded), sub-routed by `op` query: `upload`, `list`, `download`.

Relay contract: the handler dials `dialGuacd(reg.Get(connectorID), kasmControlAddr)` and writes an HTTP/1.0 request to the broker path built from `brokerSID`, then copies the response back. Mirror the request framing used by `openKasmSession`/`buildKasmCloseRequest` in `kasmtunnel.go`.

- [ ] **Step 1: Implement `serveKasmFiles` in `kasmfiles.go`**

Append to `dataplane/kasmfiles.go`:
```go
import (
	"bufio"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// serveKasmFiles relays isolated-session file transfer between the manager and the
// in-container broker, enforcing the per-site DLP mode stored in the session hub.
// Internal endpoint (secret-guarded by the caller). Query: userId, siteId, op
// (upload|list|download), name (download/upload filename).
func serveKasmFiles(hub *SessionHub, reg *Registry, audit *AuditQueue, w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	userID, siteID, op := q.Get("userId"), q.Get("siteId"), q.Get("op")
	connectorID, ctrlAddr, brokerSID, mode, host, ok := hub.IsolatedFileTarget(userID, siteID)
	if !ok {
		http.Error(w, "no active session", http.StatusConflict)
		return
	}
	up, down := fileTransferAllows(mode)
	isUpload := op == "upload"
	if (isUpload && !up) || (!isUpload && !down) {
		reason := "file-transfer-denied:" + op
		audit.Enqueue(auditEvent("DENY", reason, userID, siteID, host, r, http.StatusForbidden, 0))
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	sess := reg.Get(connectorID)
	if sess == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}
	conn, err := dialGuacd(sess, ctrlAddr)
	if err != nil {
		http.Error(w, "isolated browser unavailable", http.StatusBadGateway)
		return
	}
	defer conn.Close()

	name := _safeSeg(q.Get("name"))
	var req string
	switch op {
	case "upload":
		if name == "" {
			http.Error(w, "bad name", http.StatusBadRequest)
			return
		}
		cl := r.Header.Get("Content-Length")
		req = "POST /session/" + brokerSID + "/upload HTTP/1.0\r\n" +
			"Host: " + ctrlAddr + "\r\n" +
			"X-Filename: " + name + "\r\n" +
			"Content-Type: application/octet-stream\r\n" +
			"Content-Length: " + cl + "\r\n" +
			"Connection: close\r\n\r\n"
		if _, err := io.WriteString(conn, req); err != nil {
			http.Error(w, "relay failed", http.StatusBadGateway)
			return
		}
		if _, err := io.Copy(conn, r.Body); err != nil {
			http.Error(w, "relay failed", http.StatusBadGateway)
			return
		}
	case "download":
		if name == "" {
			http.Error(w, "bad name", http.StatusBadRequest)
			return
		}
		req = "GET /session/" + brokerSID + "/downloads/" + url.PathEscape(name) + " HTTP/1.0\r\n" +
			"Host: " + ctrlAddr + "\r\nConnection: close\r\n\r\n"
		_, _ = io.WriteString(conn, req)
	default: // list
		req = "GET /session/" + brokerSID + "/downloads HTTP/1.0\r\n" +
			"Host: " + ctrlAddr + "\r\nConnection: close\r\n\r\n"
		_, _ = io.WriteString(conn, req)
	}

	resp, rerr := http.ReadResponse(bufio.NewReader(conn), nil)
	if rerr != nil {
		http.Error(w, "relay failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if op == "download" {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	}
	w.WriteHeader(resp.StatusCode)
	n, _ := io.Copy(w, resp.Body)

	verb := "DOWNLOAD"
	if isUpload {
		verb = "UPLOAD"
	}
	if resp.StatusCode/100 == 2 && op != "list" {
		audit.Enqueue(auditEvent("ALLOW", verb+" file:"+name, userID, siteID, host, r, resp.StatusCode, n))
	}
}

// _safeSeg strips any path separators from a query-supplied filename (defense in
// depth; the broker sanitizes again).
func _safeSeg(name string) string {
	name = strings.TrimSpace(name)
	if i := strings.LastIndexAny(name, "/\\"); i >= 0 {
		name = name[i+1:]
	}
	if name == "." || name == ".." {
		return ""
	}
	return name
}
```
(Merge this `import` block into the file's existing imports — `kasmfiles.go` from Task 4 had no imports, so add the block above the helper. If gofmt/goimports complains about placement, run `gofmt -w kasmfiles.go`.)

- [ ] **Step 2: Move `audit` creation above the internal mux + register the route**

In `dataplane/main.go`:
1. The `audit := NewAuditQueue(...)` + `go RunAuditFlush(...)` block currently sits after the internal-mux `go func(){ ... ListenAndServe(in) }()` (~line 258). Cut that whole `audit`/`RunAuditFlush` block and paste it **above** the `in := http.NewServeMux()` line (~line 35), so `audit` is in scope for the internal handlers. (It only depends on `ctrl`, already defined earlier.)
2. Add, alongside the other `in.HandleFunc` registrations (e.g. after `/sessions/watch-status`, ~line 247):
```go
	in.HandleFunc("/kasm-files", func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("x-dataplane-secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		serveKasmFiles(hub, reg, audit, w, r)
	})
```

- [ ] **Step 3: Build + test the dataplane**

Run:
```bash
cd /opt/captivo-access/dataplane && gofmt -w kasmfiles.go && go build ./... && go test ./...
```
Expected: build ok; all tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /opt/captivo-access
git add dataplane/kasmfiles.go dataplane/main.go
git commit -m "feat(isolated): dataplane file-transfer relay with DLP enforcement + audit"
```

---

### Task 7: Manager API routes + dataplane client

**Files:**
- Modify: `src/lib/dataplane/client.ts`
- Create: `src/app/api/isolated/files/upload/route.ts`
- Create: `src/app/api/isolated/files/downloads/route.ts`
- Create: `src/app/api/isolated/files/download/route.ts`

**Interfaces:**
- Consumes: dataplane `/kasm-files` (Task 6); `requireUser` (existing, returns `{ id }`).
- Produces:
  - `listIsolatedDownloads(userId, siteId): Promise<{ name: string; size: number; mtime: number }[]>`
  - `uploadIsolatedFile(userId, siteId, name, body: ReadableStream|Buffer, contentLength): Promise<Response>` — thin passthrough
  - Download streams through the route directly (no client helper needed).
  - Manager routes: `POST /api/isolated/files/upload?site=`, `GET /api/isolated/files/downloads?site=`, `GET /api/isolated/files/download?site=&name=`.

- [ ] **Step 1: Add the client helper for the list**

In `src/lib/dataplane/client.ts`, append:
```ts
export interface IsolatedDownload { name: string; size: number; mtime: number }

export async function listIsolatedDownloads(userId: string, siteId: string): Promise<IsolatedDownload[]> {
  try {
    const qs = `op=list&userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}`;
    const res = await fetch(`${BASE()}/kasm-files?${qs}`, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as IsolatedDownload[] | null;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Base URL + secret header for streaming routes that proxy raw bodies (upload/
// download) rather than JSON. Exported so the route handlers can build fetches
// that stream instead of buffering.
export function dataplaneFilesUrl(qs: string): string { return `${BASE()}/kasm-files?${qs}`; }
export function dataplaneSecretHeader(): Record<string, string> { return { "x-dataplane-secret": process.env.DATAPLANE_SECRET ?? "" }; }
```

- [ ] **Step 2: Create the downloads-list route**

Create `src/app/api/isolated/files/downloads/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listIsolatedDownloads } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser();
  const siteId = new URL(req.url).searchParams.get("site") ?? "";
  if (!siteId) return NextResponse.json({ error: "site_required" }, { status: 400 });
  return NextResponse.json(await listIsolatedDownloads(user.id, siteId));
}
```

- [ ] **Step 3: Create the download-one route (streams)**

Create `src/app/api/isolated/files/download/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { dataplaneFilesUrl, dataplaneSecretHeader } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const siteId = url.searchParams.get("site") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!siteId || !name) return NextResponse.json({ error: "site_and_name_required" }, { status: 400 });
  const qs = `op=download&userId=${encodeURIComponent(user.id)}&siteId=${encodeURIComponent(siteId)}&name=${encodeURIComponent(name)}`;
  const res = await fetch(dataplaneFilesUrl(qs), { headers: dataplaneSecretHeader(), cache: "no-store" });
  if (!res.ok || !res.body) return NextResponse.json({ error: "unavailable" }, { status: res.status || 502 });
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": res.headers.get("content-disposition") ?? `attachment; filename="${name}"`,
    },
  });
}
```

- [ ] **Step 4: Create the upload route (streams, enforces size cap)**

Create `src/app/api/isolated/files/upload/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { dataplaneFilesUrl, dataplaneSecretHeader } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = Number(process.env.ISOLATED_FT_MAX_BYTES ?? 100 * 1024 * 1024);

export async function POST(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const siteId = url.searchParams.get("site") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!siteId || !name) return NextResponse.json({ error: "site_and_name_required" }, { status: 400 });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (!len || Number.isNaN(len)) return NextResponse.json({ error: "length_required" }, { status: 411 });
  if (len > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const body = await req.arrayBuffer(); // bounded by MAX_BYTES check above
  const qs = `op=upload&userId=${encodeURIComponent(user.id)}&siteId=${encodeURIComponent(siteId)}&name=${encodeURIComponent(name)}`;
  const res = await fetch(dataplaneFilesUrl(qs), {
    method: "POST",
    headers: { ...dataplaneSecretHeader(), "content-type": "application/octet-stream", "content-length": String(body.byteLength) },
    body,
  });
  return NextResponse.json(res.ok ? { ok: true } : { ok: false }, { status: res.status });
}
```

- [ ] **Step 5: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 6: Commit**

```bash
cd /opt/captivo-access
git add src/lib/dataplane/client.ts src/app/api/isolated
git commit -m "feat(isolated): manager file-transfer API routes"
```

---

### Task 8: Session UI — upload button + download tray

**Files:**
- Modify: `src/app/gateway/[siteId]/session/page.tsx`
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx`

**Interfaces:**
- Consumes: manager routes (Task 7); `site.fileTransferMode`.
- Produces: `IsolatedSession` gains a `fileTransferMode: string` prop; renders an Upload button (when upload allowed) and a polling Downloads tray (when download allowed).

- [ ] **Step 1: Select + pass `fileTransferMode` from the page**

In `src/app/gateway/[siteId]/session/page.tsx`:
1. Add `fileTransferMode: true` to the `site.findUnique` `select` (~line 21).
2. In the ISOLATED render (`<IsolatedSession .../>`, ~line 42) add the prop:
```tsx
    ? <IsolatedSession siteId={siteId} siteName={site.name} recorded={recorded} fileTransferMode={site.fileTransferMode} />
```
(The `ConsentGate` path renders the same session after consent — if `ConsentGate` forwards to `IsolatedSession`, thread `fileTransferMode` through it too; check `consent-gate.tsx` and add the prop there if it renders `IsolatedSession`.)

- [ ] **Step 2: Accept the prop + compute direction flags**

In `isolated-client.tsx`, change the component signature + add derived flags at the top of the component body:
```tsx
export function IsolatedSession({ siteId, siteName, recorded, fileTransferMode }: { siteId: string; siteName: string; recorded: boolean; fileTransferMode: string }) {
  const canUpload = fileTransferMode === "allow" || fileTransferMode === "no_download";
  const canDownload = fileTransferMode === "allow" || fileTransferMode === "no_upload";
```

- [ ] **Step 3: Add upload + downloads state and handlers**

Inside the component (after the existing `useState` hooks) add:
```tsx
  const [downloads, setDownloads] = useState<{ name: string; size: number; mtime: number }[]>([]);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canDownload) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/isolated/files/downloads?site=${siteId}`, { cache: "no-store" });
        if (res.ok && !stop) setDownloads((await res.json()) as { name: string; size: number; mtime: number }[]);
      } catch { /* ignore */ }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [siteId, canDownload]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploadMsg("Uploading…");
    try {
      const res = await fetch(`/api/isolated/files/upload?site=${siteId}&name=${encodeURIComponent(f.name)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "content-length": String(f.size) },
        body: f,
      });
      setUploadMsg(res.ok ? `Uploaded ${f.name}` : res.status === 413 ? "File too large" : "Upload failed");
    } catch {
      setUploadMsg("Upload failed");
    }
    setTimeout(() => setUploadMsg(null), 4000);
  };
```

- [ ] **Step 4: Render the controls**

In the returned JSX, add a fixed-position panel (place it near the Fullscreen button block, gated on `ready`). Keep the existing dark translucent style language:
```tsx
      {ready && dims && (canUpload || canDownload) && (
        <div style={{ position: "fixed", bottom: 12, left: 12, zIndex: 30, display: "flex", flexDirection: "column", gap: 8, maxWidth: 280 }}>
          {canUpload && (
            <div>
              <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onPick} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "6px 12px", fontFamily: "sans-serif", fontSize: 12, cursor: "pointer" }}
              >
                ↑ Upload file
              </button>
              {uploadMsg && <span style={{ marginLeft: 8, color: "#fff", fontFamily: "sans-serif", fontSize: 12 }}>{uploadMsg}</span>}
            </div>
          )}
          {canDownload && downloads.length > 0 && (
            <div style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "8px 12px", fontFamily: "sans-serif", fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Downloads ({downloads.length})</div>
              {downloads.map((d) => (
                <a
                  key={d.name}
                  href={`/api/isolated/files/download?site=${siteId}&name=${encodeURIComponent(d.name)}`}
                  download={d.name}
                  style={{ display: "block", color: "#7fd7ff", textDecoration: "none", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  ↓ {d.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 6: Commit**

```bash
cd /opt/captivo-access
git add "src/app/gateway/[siteId]/session/page.tsx" "src/app/gateway/[siteId]/session/isolated-client.tsx" "src/app/gateway/[siteId]/session/consent-gate.tsx"
git commit -m "feat(isolated): file-transfer UI (upload button + downloads tray)"
```

---

## Final verification (after all tasks)

- [ ] `cd /opt/captivo-access/dataplane && go build ./... && go test ./...` — all green.
- [ ] `cd /opt/captivo-access && npx vitest run src/lib/site/validate.test.ts` — green.
- [ ] `cd /opt/captivo-access/kasm-browser && python3 control_test.py` — prints `ok`.
- [ ] `cd /opt/captivo-access && pnpm build` — Compiled successfully, no type error.
- [ ] **Manual (post-deploy, needs explicit deploy approval + a connector update):** open an ISOLATED site with `fileTransferMode=allow`; upload a file and pick it in the isolated web app's file dialog; download a file inside the isolated Chromium and pull it from the tray. Repeat with `no_upload` / `no_download` / `none` and confirm each direction is gated (blocked calls → 403 + a DENY audit row). Confirm audit rows carry UPLOAD/DOWNLOAD + filename.

## Release (SEPARATE GATES — do not auto-run)

After the user approves deploy: rebuild the affected images (manager, dataplane, kasm-browser), update the connector, run `db push` on the prod DB, deploy. Then, on tagging, add an English user-focused `gh release edit` note. Wait for explicit approval before each of these.
