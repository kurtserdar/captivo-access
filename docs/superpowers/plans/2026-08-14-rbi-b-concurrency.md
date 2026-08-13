# RBI Transport B (KasmVNC) Concurrency Broker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline execution — subagent quota is full). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the high-fidelity (KasmVNC) isolated browser from one session at a time to N concurrent sessions via an in-container per-session broker, mirroring transport A's A2 broker.

**Architecture:** A static hub (`Xvnc :1` on fixed port 6901) serves the KasmVNC web client (HTML/assets). An in-container broker (`control.py` on :7900) spawns a per-session `Xvnc :N` on port `6900+N` + Chromium-at-url on demand and reaps it on close. The data-plane routes non-WebSocket requests to the hub and each WebSocket upgrade to a broker-allocated per-session port; session lifecycle equals WebSocket lifecycle.

**Tech Stack:** Debian + KasmVNC 1.5.0 (`Xvnc`), Python 3 stdlib (broker), Go (data-plane, `net/http/httputil` reverse proxy over a yamux relay).

## Global Constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Transport B must not import or depend on `dataplane/isolated.go` (transport A, deleted after B3) — B's broker client is self-contained in `kasmtunnel.go`.
- This slice is concurrency ONLY: clipboard DLP (B2) and hi-fi recording (B3) are out of scope.
- `MAX_SESSIONS` default 5, `MAX_SESSION_SECONDS` default 14400 (env-overridable, same as A2).
- Ports: hub 6901; per-session `6900+N` for display `N` in `2..MAX_SESSIONS+1` (so `6902..6901+MAX`).
- Deploy is a SEPARATE gate requiring explicit user approval — do NOT auto-run. Target tag v0.62.0 (dataplane + kasm image; no schema, manager unchanged).

---

### Task 1: KasmVNC broker image (entrypoint + broker)

Replace the single-session `captivo-kasm` container with a static hub + an
A2-style in-container broker. No Python test framework exists in the repo (A2 was
validated the same way) — the deliverable is validated by an image build + smoke
here, and the full concurrency spike in Task 5.

**Files:**
- Modify: `kasm-browser/entrypoint.sh`
- Modify: `kasm-browser/control.py` (full rewrite)

**Interfaces:**
- Produces: broker HTTP on `0.0.0.0:7900` — `POST /session {"url":"<http(s)>"}` → `201 {"id","port"}` | `400 {"error":"bad_url"}` | `503 {"error":"capacity"}`; `POST /session/<id>/close` → `200 {"ok":true}`; `GET /healthz` → `200 {"ok":true}`. Hub `Xvnc` web client on `:6901`. Per-session KasmVNC WS on `:6900+N`.

- [ ] **Step 1: Rewrite `kasm-browser/entrypoint.sh`**

```sh
#!/bin/sh
set -e
mkdir -p /root/.vnc
cp /kasmvnc.yaml /root/.vnc/kasmvnc.yaml
# Hub: serves the static KasmVNC web client (HTML/assets) on the fixed port 6901.
# Its display is never rendered to (no window manager, no browser) — only
# per-session Xvnc instances carry live displays. The data-plane routes only the
# web client here; each live RFB-over-WebSocket goes to a per-session port.
Xvnc :1 -geometry 1280x800 -depth 24 -websocketPort 6901 -interface 0.0.0.0 \
  -httpd /usr/share/kasmvnc/www -SecurityTypes None -disableBasicAuth &
sleep 2
exec python3 /control.py
```

- [ ] **Step 2: Rewrite `kasm-browser/control.py` as the broker**

```python
#!/usr/bin/env python3
# In-container session broker for the high-fidelity (KasmVNC) isolated browser.
# Spawns a fresh per-session Xvnc (display + RFB + web/WS on one port) + fluxbox +
# kiosk Chromium on demand and reaps it on close. No docker socket: sessions are
# PROCESSES inside this one container. The hub (Xvnc :1 on 6901, started by
# entrypoint.sh) serves the static web client; per-session ports serve live RFB.
import json, os, shutil, signal, subprocess, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHROME = shutil.which("chromium") or shutil.which("chromium-browser") or "chromium"
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "5"))
MAX_SESSION_SECONDS = int(os.environ.get("MAX_SESSION_SECONDS", "14400"))
BASE_PORT = 6900  # per-session port = BASE_PORT + display; hub is 6901 (display :1)

_lock = threading.Lock()
_sessions = {}  # id -> {"display": N, "port": p, "procs": [...], "profile": path, "started": ts}
_seq = {"n": 0}


def _free_display():
    # Displays 1 is the hub; sessions use 2..MAX_SESSIONS+1.
    used = {s["display"] for s in _sessions.values()}
    for n in range(2, MAX_SESSIONS + 2):
        if n not in used:
            return n
    return None


def _spawn(display, url, profile):
    disp = ":%d" % display
    env = {**os.environ, "DISPLAY": disp}
    os.makedirs(profile, exist_ok=True)
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
         "-disableBasicAuth"])
    time.sleep(1.5)
    fbox = subprocess.Popen(["fluxbox"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    chrome = subprocess.Popen(
        [CHROME, "--kiosk", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
         "--no-first-run", "--no-default-browser-check", "--disable-translate",
         "--user-data-dir=" + profile, url], env=env)
    return [xvnc, fbox, chrome]


def _kill(sess):
    for p in sess["procs"]:
        if p.poll() is None:
            p.send_signal(signal.SIGTERM)
    time.sleep(1.0)
    for p in sess["procs"]:
        if p.poll() is None:
            p.kill()
    shutil.rmtree(sess["profile"], ignore_errors=True)


def open_session(url):
    with _lock:
        if len(_sessions) >= MAX_SESSIONS:
            return None
        display = _free_display()
        if display is None:
            return None
        _seq["n"] += 1
        sid = "s%d-%d" % (int(time.time()), _seq["n"])
        profile = "/profiles/" + sid
        procs = _spawn(display, url, profile)
        port = BASE_PORT + display
        _sessions[sid] = {"display": display, "port": port, "procs": procs,
                          "profile": profile, "started": time.time()}
        return {"id": sid, "port": port}


def close_session(sid):
    with _lock:
        sess = _sessions.pop(sid, None)
    if sess:
        _kill(sess)


def _reaper():
    while True:
        time.sleep(60)
        now = time.time()
        with _lock:
            stale = [sid for sid, s in _sessions.items() if now - s["started"] > MAX_SESSION_SECONDS]
            for sid in stale:
                sess = _sessions.pop(sid)
                print("kasm-broker: reaping stale session " + sid, flush=True)
                threading.Thread(target=_kill, args=(sess,), daemon=True).start()


class H(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == "/healthz":
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/session":
            n = int(self.headers.get("Content-Length", "0") or "0")
            try:
                data = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                data = {}
            url = data.get("url", "")
            if not (isinstance(url, str) and (url.startswith("http://") or url.startswith("https://"))):
                return self._json(400, {"error": "bad_url"})
            res = open_session(url)
            if res is None:
                return self._json(503, {"error": "capacity"})
            return self._json(201, res)
        if path.startswith("/session/") and path.endswith("/close"):
            sid = path[len("/session/"):-len("/close")]
            close_session(sid)
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not_found"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs("/profiles", exist_ok=True)
    threading.Thread(target=_reaper, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 7900), H).serve_forever()
```

- [ ] **Step 3: Build the image**

Run: `cd /opt/captivo-access && docker build -f kasm-browser/Dockerfile -t captivo-access-kasm-browser:dbg .`
Expected: build succeeds.

- [ ] **Step 4: Smoke — hub + broker up, one session opens on a per-session port**

```bash
docker rm -f kasm-smoke 2>/dev/null
docker run -d --name kasm-smoke --shm-size=1g captivo-access-kasm-browser:dbg
sleep 6
# broker health
docker exec kasm-smoke sh -c 'apt-get -o Dir::Etc::sourcelist=/dev/null install -y curl >/dev/null 2>&1; curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:7900/healthz || wget -qO- http://127.0.0.1:7900/healthz'
# open a session -> expect {"id":...,"port":6902}
docker exec kasm-smoke sh -c 'wget -qO- --post-data="{\"url\":\"https://example.com\"}" --header="Content-Type: application/json" http://127.0.0.1:7900/session'
echo
# per-session KasmVNC web client answers on 6902
docker exec kasm-smoke sh -c 'wget -qS -O /dev/null http://127.0.0.1:6902/ 2>&1 | head -1'
docker rm -f kasm-smoke
```

Expected: `health` 200; `/session` returns `{"id":"s...","port":6902}`; port 6902 serves an HTTP response (KasmVNC www). If `wget`/`curl` are absent in the image, use `python3 -c` one-liners instead (Python is present).

- [ ] **Step 5: Commit**

```bash
git add kasm-browser/entrypoint.sh kasm-browser/control.py
git commit -m "feat(rbi): KasmVNC in-container concurrency broker (hub + per-session)"
```

---

### Task 2: Data-plane broker client + address helper

Add the self-contained broker client and the per-session address helper to
`kasmtunnel.go`, independent of `isolated.go`. TDD via Go tests.

**Files:**
- Modify: `dataplane/kasmtunnel.go`
- Test: `dataplane/kasmtunnel_test.go`

**Interfaces:**
- Produces:
  - `openKasmSession(rw io.ReadWriter, host, url string) (id string, port, status int, err error)` — writes `POST /session` over the relay stream, parses `{id,port}`; returns `status` (so a 503 capacity surfaces) and `err` only on transport/parse failure.
  - `buildKasmCloseRequest(host, id string) string` — `POST /session/<id>/close` HTTP/1.0 request text.
  - `kasmSessionAddr(kasmAddr string, port int) string` — keep the host of `kasmAddr` (`host:port`), swap in `port`.

- [ ] **Step 1: Write the failing tests**

Add to `dataplane/kasmtunnel_test.go` (imports: `bufio`, `io`, `strings`, `testing`; keep existing `net/http/httptest` for `TestKasmPathStrip`):

```go
func TestKasmSessionAddr(t *testing.T) {
	if got := kasmSessionAddr("captivo-kasm:6901", 6903); got != "captivo-kasm:6903" {
		t.Fatalf("got %q", got)
	}
	// No port in input: append.
	if got := kasmSessionAddr("captivo-kasm", 6902); got != "captivo-kasm:6902" {
		t.Fatalf("got %q", got)
	}
}

type rwPair struct {
	io.Reader
	io.Writer
}

func TestOpenKasmSessionOK(t *testing.T) {
	resp := "HTTP/1.0 201 Created\r\nContent-Type: application/json\r\nContent-Length: 27\r\n\r\n{\"id\":\"s1-1\",\"port\":6902}\r\n"
	var out strings.Builder
	rw := rwPair{Reader: bufio.NewReader(strings.NewReader(resp)), Writer: &out}
	id, port, status, err := openKasmSession(rw, "captivo-kasm:7900", "https://example.com")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if id != "s1-1" || port != 6902 || status != 201 {
		t.Fatalf("id=%q port=%d status=%d", id, port, status)
	}
	if !strings.Contains(out.String(), "POST /session HTTP/1.0") {
		t.Fatalf("request not written: %q", out.String())
	}
}

func TestOpenKasmSessionCapacity(t *testing.T) {
	resp := "HTTP/1.0 503 Service Unavailable\r\nContent-Length: 22\r\n\r\n{\"error\":\"capacity\"}\r\n"
	rw := rwPair{Reader: bufio.NewReader(strings.NewReader(resp)), Writer: &strings.Builder{}}
	_, _, status, err := openKasmSession(rw, "captivo-kasm:7900", "https://example.com")
	if err != nil {
		t.Fatalf("capacity should not be a transport error: %v", err)
	}
	if status != 503 {
		t.Fatalf("status=%d want 503", status)
	}
}
```

Also DELETE `TestKasmSingleFlight` from the file (the single-flight guard is removed in Task 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /opt/captivo-access/dataplane && go test ./... 2>&1 | head -20`
Expected: compile failure — `openKasmSession` / `kasmSessionAddr` undefined.

- [ ] **Step 3: Implement the broker client + helper in `kasmtunnel.go`**

Replace the top of `kasmtunnel.go` — remove `isoGuard`, `buildNavigateRequest`, `buildResetRequest`, and the `var kasmSession isoGuard` line — with these functions. Update the import block to add `bufio`, `encoding/json`, `strconv` and drop `sync/atomic` (no longer used):

```go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
)

// openKasmSession asks the in-container broker to start an isolated KasmVNC
// session at url and returns the assigned per-session port. It writes an HTTP/1.0
// POST /session and reads the response over the same relay stream. status is the
// HTTP status (so the caller can surface 503 capacity); err is set only on
// transport/parse failure. This is deliberately self-contained (not shared with
// transport A's isolated.go, which is retired after B3).
func openKasmSession(rw io.ReadWriter, host, url string) (id string, port, status int, err error) {
	body := `{"url":` + jsonQuoteKasm(url) + `}`
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

// buildKasmCloseRequest formats the broker POST /session/<id>/close call.
func buildKasmCloseRequest(host, id string) string {
	return "POST /session/" + id + "/close HTTP/1.0\r\nHost: " + host +
		"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
}

// kasmSessionAddr keeps the host of kasmAddr (host[:port]) and swaps in the
// per-session port, so the reverse-proxy dials the right per-session backend.
func kasmSessionAddr(kasmAddr string, port int) string {
	host := kasmAddr
	if i := strings.LastIndex(kasmAddr, ":"); i >= 0 {
		host = kasmAddr[:i]
	}
	return host + ":" + strconv.Itoa(port)
}

// jsonQuoteKasm JSON-quotes a string (safe against embedded quotes/backslashes).
func jsonQuoteKasm(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
```

Note: the file still needs an `io` import for `io.ReadWriter`/`io.WriteString` — add `"io"` to the import block. (Task 3 rewrites `serveKasmTunnel` below these functions; leaving the old body temporarily referencing the deleted guard is fine only until Task 3, so Steps 3–4 here compile by also applying Task 3's edit. To keep this task independently green, do Task 3's `serveKasmTunnel` edit now if the build fails — they ship together.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /opt/captivo-access/dataplane && go test ./... 2>&1 | tail -20`
Expected: PASS (all tests, including the two new `openKasmSession` tests and `kasmSessionAddr`).

- [ ] **Step 5: Commit**

```bash
git add dataplane/kasmtunnel.go dataplane/kasmtunnel_test.go
git commit -m "feat(rbi): self-contained KasmVNC broker client + per-session addr helper"
```

---

### Task 3: Wire `serveKasmTunnel` to the broker (remove single-flight)

Rewrite `serveKasmTunnel`'s WS branch to allocate a per-session port from the
broker and reverse-proxy the WebSocket to it, closing on WS end; keep non-WS
requests going to the hub.

**Files:**
- Modify: `dataplane/kasmtunnel.go` (`serveKasmTunnel`)

**Interfaces:**
- Consumes: `openKasmSession`, `buildKasmCloseRequest`, `kasmSessionAddr` (Task 2); `dialGuacd(sess, addr)` (existing generic relay); `kasmDesc` fields `KasmAddr`, `KasmControlAddr`, `NavigateUrl`, `ConnectorID`.

- [ ] **Step 1: Replace the `serveKasmTunnel` body**

Replace the entire `serveKasmTunnel` function (from the WS-upgrade block down) so it no longer references `kasmSession`, `buildResetRequest`, or `buildNavigateRequest`. The session-resolve + descriptor + `ca_kasm_site` cookie block at the top stays unchanged; replace everything from `sess := reg.Get(d.ConnectorID)` onward with:

```go
	sess := reg.Get(d.ConnectorID)
	if sess == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}

	// Non-WebSocket requests (the KasmVNC web client HTML + assets) are static and
	// identical for every session, so they go to the always-on hub. Only the live
	// RFB-over-WebSocket needs a per-session Xvnc.
	backendAddr := d.KasmAddr
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		// A WebSocket upgrade IS the session boundary. Open a fresh per-session
		// browser via the broker and proxy this WS to its port; close it when the
		// WS ends. Concurrency is capped by the broker (503 capacity).
		var id string
		var port, status int
		if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
			id, port, status, e = openKasmSession(st, d.KasmControlAddr, d.NavigateUrl)
			st.Close()
			if e != nil {
				http.Error(w, "isolated browser unavailable", http.StatusBadGateway)
				return
			}
		} else {
			http.Error(w, "isolated browser unavailable", http.StatusBadGateway)
			return
		}
		if status == 503 {
			http.Error(w, "isolated browser at capacity", http.StatusServiceUnavailable)
			return
		}
		if status/100 != 2 || port == 0 {
			http.Error(w, "isolated browser unavailable", http.StatusBadGateway)
			return
		}
		backendAddr = kasmSessionAddr(d.KasmAddr, port)
		log.Printf("kasm-tunnel site=%s: hi-fi session %s started on port %d", siteID, id, port)
		defer func() {
			if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
				_, _ = st.Write([]byte(buildKasmCloseRequest(d.KasmControlAddr, id)))
				_ = st.Close()
			}
			log.Printf("kasm-tunnel site=%s: hi-fi session %s closed", siteID, id)
		}()
	}

	target, _ := url.Parse("http://" + backendAddr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return dialGuacd(sess, backendAddr) // relay to KasmVNC through the connector
		},
	}
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/kasm-tunnel")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}
	proxy.ServeHTTP(w, r)
}
```

- [ ] **Step 2: Build + test the data-plane**

Run: `cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -20`
Expected: build succeeds; all tests PASS. No references to `isoGuard`, `kasmSession`, `buildNavigateRequest`, `buildResetRequest` remain.

- [ ] **Step 3: Verify B does not depend on transport A**

Run: `cd /opt/captivo-access/dataplane && grep -n 'isoGuard\|kasmSession\|openBrowserSession\|buildNavigateRequest\|buildResetRequest' kasmtunnel.go kasmtunnel_test.go || echo "clean"`
Expected: `clean` (kasmtunnel no longer references A's guard or the removed builders).

- [ ] **Step 4: Commit**

```bash
git add dataplane/kasmtunnel.go
git commit -m "feat(rbi): route KasmVNC WS to per-session broker port, drop single-flight"
```

---

### Task 4: Full verification (build image + Go + local concurrency spike)

Prove the whole slice end to end locally before deploy.

**Files:** none (verification only)

- [ ] **Step 1: Manager build stays green (unaffected but confirm)**

Run: `cd /opt/captivo-access && pnpm build > /tmp/b-conc-build.log 2>&1; echo "exit=$?"; tail -3 /tmp/b-conc-build.log`
Expected: `exit=0`.

- [ ] **Step 2: Go build + tests**

Run: `cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 3: Build the kasm image**

Run: `cd /opt/captivo-access && docker build -f kasm-browser/Dockerfile -t captivo-access-kasm-browser:dbg .`
Expected: build succeeds.

- [ ] **Step 4: Local concurrency spike (MAX_SESSIONS=3)**

```bash
docker rm -f kasm-conc 2>/dev/null
docker run -d --name kasm-conc --shm-size=1g -e MAX_SESSIONS=3 captivo-access-kasm-browser:dbg
sleep 6
open() { docker exec kasm-conc python3 -c "import urllib.request,json;print(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7900/session',data=b'{\"url\":\"https://example.com\"}',headers={'Content-Type':'application/json'})).read().decode())"; }
close() { docker exec kasm-conc python3 -c "import urllib.request;print(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7900/session/$1/close',data=b'',method='POST')).read().decode())"; }
cap() { docker exec kasm-conc python3 -c "import urllib.request,urllib.error;req=urllib.request.Request('http://127.0.0.1:7900/session',data=b'{\"url\":\"https://example.com\"}',headers={'Content-Type':'application/json'});\nimport sys\ntry:\n print('unexpected',urllib.request.urlopen(req).read().decode())\nexcept urllib.error.HTTPError as e:\n print('status',e.code,e.read().decode())"; }
echo "--- open 3 sessions (expect ports 6902/6903/6904) ---"; A=$(open); echo "$A"; B=$(open); echo "$B"; C=$(open); echo "$C"
echo "--- Xvnc count (expect 4 = hub + 3) ---"; docker exec kasm-conc sh -c 'ps -e | grep -c Xvnc'
echo "--- 4th open (expect status 503 capacity) ---"; cap
ID=$(echo "$A" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "--- close first ($ID), profile should be gone ---"; close "$ID"; docker exec kasm-conc sh -c 'ls /profiles | wc -l'
echo "--- reopen reuses freed slot (expect a 690x port again) ---"; open
docker rm -f kasm-conc
```

Expected: three sessions on distinct ports 6902/6903/6904; `Xvnc` count 4; 4th → `status 503 {"error":"capacity"}`; after close, `/profiles` count drops to 2; reopen succeeds on a freed port. (If a helper heredoc misbehaves, run the equivalent Python inline — Python 3 is in the image.)

- [ ] **Step 5: Commit any spike-driven fixes (if needed)**

Only if Steps 1–4 surfaced a fix. Otherwise skip.

```bash
git add -A && git commit -m "fix(rbi): <describe spike fix>"
```

---

## Deployment (SEPARATE GATE — explicit user approval required, do NOT auto-run)

Target **v0.62.0** — `dataplane` + `kasm-browser` images only (no schema, manager unchanged).

1. `git push origin main` + `git tag v0.62.0 && git push origin v0.62.0`; watch `publish.yml` green.
2. In `/opt/captivo-access-prod/docker-compose.yml`, bump the `access-dataplane` image tag to `0.62.0` (manager stays 0.61.2); `docker compose pull access-dataplane && docker compose up -d access-dataplane`.
3. On the gateway host, **Update the connector** so it pulls `captivo-access-kasm-browser:latest` and recreates `captivo-kasm` (bundled `:latest`, pulled on update per `repair.ts`).
4. Verify: `/login` 200; open the hi-fi ISOLATED site in a browser; confirm the KasmVNC session renders and that a second concurrent vendor also renders (no "in use").
5. `gh release edit v0.62.0 --notes "<English, user-focused>"`. No Claude signature.

**Gate-A (operator):** two vendors open the hi-fi ISOLATED site simultaneously → both render on separate profiles; exceeding `MAX_SESSIONS` shows "at capacity"; closing a tab frees a slot.

---

## Self-Review

**Spec coverage:** hub + per-session split (Task 1 entrypoint + broker) ✓; broker contract POST/close/healthz + stale-lock clear + TTL reaper + MAX_SESSIONS/port math (Task 1) ✓; data-plane single-flight removal + self-contained broker client + `kasmSessionAddr` + WS→per-session / non-WS→hub routing + close on WS end + 503/502 handling (Tasks 2–3) ✓; tests keep `TestKasmPathStrip`, replace `TestKasmSingleFlight` (Task 2) ✓; verification build+go+spike (Task 4) ✓; deploy dataplane+kasm image, connector Update, English note (Deployment) ✓.

**Placeholder scan:** none — all code is concrete; the one conditional ("commit spike fixes if needed") is a real branch, not a placeholder.

**Type consistency:** broker returns JSON `{"id","port"}`; `openKasmSession` decodes `{ID, Port}` and returns `(id string, port int, status int, err error)`; `kasmSessionAddr(string, int) string`; `serveKasmTunnel` uses `port`/`id` from `openKasmSession` and `backendAddr` from `kasmSessionAddr`. Port math consistent: hub 6901/display 1; sessions display 2..MAX+1 → ports 6902..6901+MAX (spike MAX=3 → 6902/6903/6904). `jsonQuoteKasm` is B-local (avoids colliding with `jsonQuote` in `isolated.go`).
