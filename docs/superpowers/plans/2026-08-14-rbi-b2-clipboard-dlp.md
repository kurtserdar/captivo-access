# RBI Transport B (KasmVNC) Clipboard DLP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline execution — subagent quota is full). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the high-fidelity (KasmVNC) isolated browser honor the site's per-site `clipboardMode`, blocking copy-out and/or paste-in exactly as transport A does.

**Architecture:** The descriptor's kasm branch returns the site's `clipboardMode`; the data-plane maps it to two KasmVNC DLP booleans and passes them to the broker on `POST /session`; the broker writes a per-session `kasmvnc.yaml` (with the clipboard keys removed from `allow_override_list` so the client can't re-enable) under a per-session `HOME` and starts that session's `Xvnc` there.

**Tech Stack:** Go (data-plane mapping + broker call), Python 3 stdlib (broker per-session yaml), KasmVNC `data_loss_prevention.clipboard` config, Next.js descriptor route (TS).

## Global Constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Transport B must not import or depend on `dataplane/isolated.go` (transport A, deleted after B3).
- Clipboard control is per-site only (no policy layer); watermark/region DLP is a separate future slice.
- `clipboardMode` values: `allow | no_copy | no_paste | none`; unknown/empty → allow (no B1 regression).
- Mapping: `allow`→(copyOut=t, pasteIn=t); `no_copy`→(f, t); `no_paste`→(t, f); `none`→(f, f).
- Deploy is a SEPARATE gate requiring explicit user approval — do NOT auto-run. Target tag v0.63.0 (manager + dataplane + kasm image; no schema).

---

### Task 1: Data-plane — clipboard mapping + broker-call flags

Map `clipboardMode` to the KasmVNC DLP booleans and pass them to the broker. TDD in Go.

**Files:**
- Modify: `dataplane/kasmtunnel.go`
- Test: `dataplane/kasmtunnel_test.go`

**Interfaces:**
- Consumes (existing): `openKasmSession`, `kasmDesc`, `dialGuacd`, `kasmSessionAddr` (B-concurrency).
- Produces:
  - `clipboardToKasm(mode string) (copyOut, pasteIn bool)`.
  - `openKasmSession(rw io.ReadWriter, host, target string, copyOut, pasteIn bool) (id string, port, status int, err error)` — new trailing bool params; body gains `"copyOut"`/`"pasteIn"`.
  - `kasmDesc.ClipboardMode string` (json `clipboardMode`).

- [ ] **Step 1: Write the failing tests**

Replace the two existing `openKasmSession` tests' call sites and add the mapping test in `dataplane/kasmtunnel_test.go`. Add `clipboardToKasm` test:

```go
func TestClipboardToKasm(t *testing.T) {
	cases := []struct {
		mode              string
		copyOut, pasteIn  bool
	}{
		{"allow", true, true},
		{"no_copy", false, true},
		{"no_paste", true, false},
		{"none", false, false},
		{"", true, true},
		{"bogus", true, true},
	}
	for _, c := range cases {
		co, pi := clipboardToKasm(c.mode)
		if co != c.copyOut || pi != c.pasteIn {
			t.Fatalf("%q -> (%v,%v) want (%v,%v)", c.mode, co, pi, c.copyOut, c.pasteIn)
		}
	}
}
```

Update `TestOpenKasmSessionOK` to call with flags and assert the body carries them:

```go
func TestOpenKasmSessionOK(t *testing.T) {
	body := `{"id":"s1-1","port":6902}`
	resp := "HTTP/1.0 201 Created\r\nContent-Type: application/json\r\nContent-Length: " +
		strconv.Itoa(len(body)) + "\r\n\r\n" + body
	var out strings.Builder
	rw := rwPair{Reader: bufio.NewReader(strings.NewReader(resp)), Writer: &out}
	id, port, status, err := openKasmSession(rw, "captivo-kasm:7900", "https://example.com", false, true)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if id != "s1-1" || port != 6902 || status != 201 {
		t.Fatalf("id=%q port=%d status=%d", id, port, status)
	}
	if !strings.Contains(out.String(), "POST /session HTTP/1.0") {
		t.Fatalf("request not written: %q", out.String())
	}
	if !strings.Contains(out.String(), `"copyOut":false`) || !strings.Contains(out.String(), `"pasteIn":true`) {
		t.Fatalf("clipboard flags missing from body: %q", out.String())
	}
}
```

Update `TestOpenKasmSessionCapacity`'s call site to the new signature:

```go
	_, _, status, err := openKasmSession(rw, "captivo-kasm:7900", "https://example.com", true, true)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /opt/captivo-access/dataplane && go test ./... 2>&1 | head -20`
Expected: compile failure — `clipboardToKasm` undefined and `openKasmSession` arg count mismatch.

- [ ] **Step 3: Implement in `kasmtunnel.go`**

Add `clipboardToKasm` (near the other helpers) and the `ClipboardMode` field on `kasmDesc`:

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

On `kasmDesc`, add:

```go
	ClipboardMode   string `json:"clipboardMode"`
```

Change `openKasmSession` to take the flags and emit them:

```go
func openKasmSession(rw io.ReadWriter, host, target string, copyOut, pasteIn bool) (id string, port, status int, err error) {
	body := `{"url":` + jsonQuoteKasm(target) +
		`,"copyOut":` + strconv.FormatBool(copyOut) +
		`,"pasteIn":` + strconv.FormatBool(pasteIn) + `}`
	req := "POST /session HTTP/1.0\r\n" +
		"Host: " + host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: " + strconv.Itoa(len(body)) + "\r\n" +
		"Connection: close\r\n\r\n" + body
	if _, err = io.WriteString(rw, req); err != nil {
		return "", 0, 0, err
	}
	resp, rerr := http.ReadResponse(bufio.NewReader(rw), nil)
	if rerr != nil {
		return "", 0, 0, rerr
	}
	defer resp.Body.Close()
	status = resp.StatusCode
	if status/100 != 2 {
		return "", 0, status, nil
	}
	var out struct {
		ID   string `json:"id"`
		Port int    `json:"port"`
	}
	if derr := json.NewDecoder(resp.Body).Decode(&out); derr != nil {
		return "", 0, status, derr
	}
	return out.ID, out.Port, status, nil
}
```

Update the `serveKasmTunnel` WS-upgrade call site (where `openKasmSession` is invoked) to map and pass the flags:

```go
		co, pi := clipboardToKasm(d.ClipboardMode)
		if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
			id, port, status, e = openKasmSession(st, d.KasmControlAddr, d.NavigateUrl, co, pi)
			st.Close()
			if e != nil {
				http.Error(w, "isolated browser unavailable", http.StatusBadGateway)
				return
			}
		} else {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -6`
Expected: build succeeds; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dataplane/kasmtunnel.go dataplane/kasmtunnel_test.go
git commit -m "feat(rbi): map clipboardMode to KasmVNC DLP flags on the broker call"
```

---

### Task 2: Broker — per-session DLP yaml under a per-session HOME

The broker writes a per-session `kasmvnc.yaml` reflecting the clipboard flags and
starts that session's `Xvnc` with its own `HOME`. No Python test framework — the
deliverable is validated by the image build + spike in Task 4.

**Files:**
- Modify: `kasm-browser/control.py`

**Interfaces:**
- Consumes: broker `POST /session` body now includes `copyOut`/`pasteIn` (from Task 1).
- Produces: each session's `Xvnc` reads `<home>/.vnc/kasmvnc.yaml` with the clipboard DLP booleans and no clipboard keys in `allow_override_list`.

- [ ] **Step 1: Add the per-session yaml builder**

Add near the top of `kasm-browser/control.py` (after the imports/constants):

```python
def _session_yaml(copy_out, paste_in):
    # Per-session KasmVNC config: network (plain HTTP, no SSL — access is
    # grant-checked at the tunnel entry) + clipboard DLP. The clipboard keys are
    # deliberately absent from allow_override_list so the web client cannot
    # re-enable a blocked direction.
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
        "    - pointer.enabled\n"
        "data_loss_prevention:\n"
        "  clipboard:\n"
        "    server_to_client:\n"
        "      enabled: " + ("true" if copy_out else "false") + "\n"
        "      primary_clipboard_enabled: false\n"
        "    client_to_server:\n"
        "      enabled: " + ("true" if paste_in else "false") + "\n")
```

- [ ] **Step 2: Thread HOME + flags through `_spawn`**

Change `_spawn` to take `home`, `copy_out`, `paste_in`, write the per-session
yaml, and start `Xvnc` (and fluxbox/chromium) with `HOME=home`:

```python
def _spawn(display, url, profile, home, copy_out, paste_in):
    disp = ":%d" % display
    env = {**os.environ, "DISPLAY": disp, "HOME": home}
    os.makedirs(profile, exist_ok=True)
    os.makedirs(home + "/.vnc", exist_ok=True)
    with open(home + "/.vnc/kasmvnc.yaml", "w") as f:
        f.write(_session_yaml(copy_out, paste_in))
    # A SIGKILLed predecessor on this (reused) display can leave a stale X lock +
    # socket, so the new Xvnc refuses to start and then serves a dead/blank display
    # — an intermittent blank-session hang. Clear both before starting.
    for stale in ("/tmp/.X%d-lock" % display, "/tmp/.X11-unix/X%d" % display):
        try:
            os.remove(stale)
        except OSError:
            pass
    port = BASE_PORT + display
    xvnc = subprocess.Popen(
        ["Xvnc", disp, "-geometry", "1280x800", "-depth", "24",
         "-websocketPort", str(port), "-interface", "0.0.0.0",
         "-httpd", "/usr/share/kasmvnc/www", "-SecurityTypes", "None",
         "-disableBasicAuth"], env=env)
    time.sleep(1.5)
    fbox = subprocess.Popen(["fluxbox"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    chrome = subprocess.Popen(
        [CHROME, "--kiosk", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
         "--no-first-run", "--no-default-browser-check", "--disable-translate",
         "--user-data-dir=" + profile, url], env=env)
    return [xvnc, fbox, chrome]
```

Note: the key change vs today is `env=env` is now passed to the `Xvnc` Popen (it
previously inherited HOME=/root and read the hub's global yaml), and `env` now
carries `HOME=home`.

- [ ] **Step 3: Record `home`, pass flags in `open_session`, reap `home` in `_kill`**

In `open_session(url, copy_out, paste_in)`:

```python
def open_session(url, copy_out, paste_in):
    with _lock:
        if len(_sessions) >= MAX_SESSIONS:
            return None
        display = _free_display()
        if display is None:
            return None
        _seq["n"] += 1
        sid = "s%d-%d" % (int(time.time()), _seq["n"])
        profile = "/profiles/" + sid
        home = "/sess/" + sid
        procs = _spawn(display, url, profile, home, copy_out, paste_in)
        port = BASE_PORT + display
        _sessions[sid] = {"display": display, "port": port, "procs": procs,
                          "profile": profile, "home": home, "started": time.time()}
        return {"id": sid, "port": port}
```

In `_kill`, also remove the session home:

```python
    shutil.rmtree(sess["profile"], ignore_errors=True)
    shutil.rmtree(sess["home"], ignore_errors=True)
```

- [ ] **Step 4: Read the flags in the `POST /session` handler**

In `do_POST`, after parsing `url`, read the flags and pass them:

```python
            url = data.get("url", "")
            if not (isinstance(url, str) and (url.startswith("http://") or url.startswith("https://"))):
                return self._json(400, {"error": "bad_url"})
            copy_out = data.get("copyOut", True)
            paste_in = data.get("pasteIn", True)
            res = open_session(url, copy_out, paste_in)
```

- [ ] **Step 5: Commit**

```bash
git add kasm-browser/control.py
git commit -m "feat(rbi): per-session KasmVNC clipboard DLP config in the broker"
```

---

### Task 3: Manager — descriptor returns clipboardMode for kasm

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts:38-45`

**Interfaces:**
- Produces: the kasm descriptor response includes `clipboardMode` (consumed by `kasmDesc.ClipboardMode` in Task 1). The `select` at line 29 already fetches `clipboardMode`.

- [ ] **Step 1: Add the field to the kasm branch**

In the `if (site.isolationHiFi)` branch, add `clipboardMode` to the returned JSON:

```ts
    if (site.isolationHiFi) {
      return NextResponse.json({
        transport: "kasm",
        navigateUrl: site.upstreamUrl ?? "",
        kasmAddr: (process.env.ISOLATED_KASM_ADDR ?? "captivo-kasm:6901").trim(),
        kasmControlAddr: (process.env.ISOLATED_KASM_CONTROL_ADDR ?? "captivo-kasm:7900").trim(),
        connectorId: site.connectorId,
        clipboardMode: site.clipboardMode,
        record: false, // hi-fi recording = B3
      });
    }
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/captivo-access && pnpm build > /tmp/b2-mgr.log 2>&1; echo "exit=$?"; tail -3 /tmp/b2-mgr.log`
Expected: `exit=0` (Compiled successfully).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/internal/gateway/descriptor/route.ts
git commit -m "feat(rbi): return clipboardMode in the hi-fi isolated descriptor"
```

---

### Task 4: Full verification (build image + Go + broker spike + concurrency regression)

**Files:** none (verification only)

- [ ] **Step 1: Go build + tests**

Run: `cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 2: Manager build**

Run: `cd /opt/captivo-access && pnpm build > /tmp/b2-build.log 2>&1; echo "exit=$?"; tail -3 /tmp/b2-build.log`
Expected: `exit=0`.

- [ ] **Step 3: Build the kasm image**

Run: `cd /opt/captivo-access && docker build -f kasm-browser/Dockerfile -t captivo-access-kasm-browser:dbg .`
Expected: build succeeds.

- [ ] **Step 4: Broker DLP spike — per-session yaml reflects the flags**

```bash
docker rm -f kasm-dlp 2>/dev/null
docker run -d --name kasm-dlp --shm-size=1g captivo-access-kasm-browser:dbg >/dev/null
sleep 6
# open a block-copy-out session
RES=$(docker exec kasm-dlp python3 -c "import urllib.request;r=urllib.request.Request('http://127.0.0.1:7900/session',data=b'{\"url\":\"https://example.com\",\"copyOut\":false,\"pasteIn\":true}',headers={'Content-Type':'application/json'});print(urllib.request.urlopen(r).read().decode())")
echo "session: $RES"
ID=$(echo "$RES" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "--- per-session yaml (expect server_to_client.enabled: false, client_to_server.enabled: true) ---"
docker exec kasm-dlp sh -c "cat /sess/$ID/.vnc/kasmvnc.yaml"
echo "--- allow_override_list must NOT contain clipboard keys ---"
docker exec kasm-dlp sh -c "grep -A3 allow_override_list /sess/$ID/.vnc/kasmvnc.yaml"
docker rm -f kasm-dlp >/dev/null
```

Expected: yaml shows `server_to_client.enabled: false` and `client_to_server.enabled: true`; `allow_override_list` lists only `pointer.enabled` (no `data_loss_prevention.clipboard.*`).

- [ ] **Step 5: Concurrency regression (MAX_SESSIONS=3, unchanged behaviour)**

```bash
docker rm -f kasm-conc 2>/dev/null
docker run -d --name kasm-conc --shm-size=1g -e MAX_SESSIONS=3 captivo-access-kasm-browser:dbg >/dev/null
sleep 6
OPEN='import urllib.request;r=urllib.request.Request("http://127.0.0.1:7900/session",data=b"{\"url\":\"https://example.com\"}",headers={"Content-Type":"application/json"});print(urllib.request.urlopen(r).read().decode())'
docker exec kasm-conc python3 -c "$OPEN"; docker exec kasm-conc python3 -c "$OPEN"; docker exec kasm-conc python3 -c "$OPEN"
echo "--- Xvnc count (expect 4 = hub + 3) ---"; docker exec kasm-conc sh -c 'ps -e | grep -c Xvnc'
echo "--- 4th (expect 503) ---"; docker exec kasm-conc python3 -c 'import urllib.request,urllib.error
r=urllib.request.Request("http://127.0.0.1:7900/session",data=b"{\"url\":\"https://example.com\"}",headers={"Content-Type":"application/json"})
try:
 print("unexpected",urllib.request.urlopen(r).read().decode())
except urllib.error.HTTPError as e:
 print("status",e.code)'
docker rm -f kasm-conc >/dev/null
```

Expected: three sessions succeed (default allow, no flags), Xvnc count 4, 4th → status 503. Confirms B2 did not regress concurrency.

- [ ] **Step 6: Commit any spike-driven fix (only if needed)**

```bash
git add -A && git commit -m "fix(rbi): <describe spike fix>"
```

---

## Deployment (SEPARATE GATE — explicit user approval required, do NOT auto-run)

Target **v0.63.0** — `manager` (descriptor field) + `dataplane` + `kasm-browser` images. No schema.

1. `git push origin main` + `git tag v0.63.0 && git push origin v0.63.0`; watch `publish.yml` green.
2. In `/opt/captivo-access-prod/docker-compose.yml`, bump `access-manager` and `access-dataplane` to `0.63.0`; `docker compose pull access-manager access-dataplane && docker compose up -d access-manager access-dataplane`.
3. On the gateway host, **Update the connector** so it pulls the new `captivo-access-kasm-browser:latest` (broker DLP) and recreates `captivo-kasm`.
4. Verify: `/login` 200; `docker exec cap-access-manager sh -c 'echo $APP_VERSION'` → 0.63.0.
5. `gh release edit v0.63.0 --notes "<English, user-focused>"`. No Claude signature.

**Gate-A (operator):** a hi-fi ISOLATED site with Clipboard = "Block copy out" → copy inside the isolated Proxmox → paste into a local app → nothing transfers; an "Allow" site still copies; paste-in behaves per its mode.

---

## Self-Review

**Spec coverage:** clipboardMode→booleans mapping + table (Task 1 `clipboardToKasm`) ✓; kasmDesc.ClipboardMode + openKasmSession flags + serveKasmTunnel wiring (Task 1) ✓; per-session DLP yaml with clipboard removed from allow_override_list + per-session HOME (Task 2) ✓; descriptor kasm branch returns clipboardMode (Task 3) ✓; unknown/empty→allow default (Task 1 `clipboardToKasm` default + Task 2 `.get(...,True)`) ✓; tests clipboardToKasm 6-case + openKasmSession body flags (Task 1) ✓; verification build+go+DLP spike+concurrency regression (Task 4) ✓; deploy manager+dataplane+kasm, connector Update, English note (Deployment) ✓.

**Placeholder scan:** none — all code concrete; the one conditional (Task 4 Step 6 "only if needed") is a real branch.

**Type consistency:** `clipboardToKasm(string) (bool,bool)` used identically in test, helper, and `serveKasmTunnel`; `openKasmSession(rw, host, target string, copyOut, pasteIn bool)` matches both updated test call sites and the `serveKasmTunnel` call; broker `open_session(url, copy_out, paste_in)` matches `do_POST`'s call and `_spawn(display, url, profile, home, copy_out, paste_in)`; JSON keys `copyOut`/`pasteIn` consistent between Go body and Python `data.get("copyOut"/"pasteIn")`; `_sessions[...]` dict gains `"home"` used by `_kill`. Booleans map consistently to `server_to_client.enabled` (copyOut) / `client_to_server.enabled` (pasteIn).
