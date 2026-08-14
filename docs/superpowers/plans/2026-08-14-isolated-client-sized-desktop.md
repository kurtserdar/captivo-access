# Client-sized Isolated Desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the isolated desktop (Xvnc + recorder) at the vendor's own screen size so browser-fullscreen fills exactly with no letterbox, and recordings capture the full screen.

**Architecture:** The client measures `screen.width×height` (clamped) and passes it on the `/kasm-tunnel/` URL; a `ca_kasm_size` cookie carries it to the query-less websockify upgrade; the data-plane threads it to the broker's `POST /session`; the broker sizes `Xvnc -geometry` + ffmpeg `-video_size` to it. Fixed per session (recording stays correct); `resize=scale` unchanged; missing size falls back to 1280×800.

**Tech Stack:** Python broker, Go data-plane, Next.js/TypeScript manager. No schema change.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Backward compatible: no size → 1280×800 (today's behaviour). Clamp to [1024..2560]×[640..1600].
- Do not break live watching, terminate, recording finalize/seek, the vendor session, or GATEWAY.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Spike — Xvnc + ffmpeg at a non-default geometry

**Files:** none (throwaway container run).

- [ ] **Step 1: Start Xvnc at 1470x956, record 2s, check resolution**

Run:
```bash
docker run --rm --entrypoint sh ghcr.io/kurtserdar/captivo-access-kasm-browser:0.70.0 -c '
Xvnc :90 -geometry 1470x956 -depth 24 -SecurityTypes None -disableBasicAuth >/dev/null 2>&1 &
sleep 2;
ffmpeg -loglevel error -f x11grab -video_size 1470x956 -framerate 10 -i :90 -t 2 -an -c:v libvpx -b:v 1M -deadline realtime /tmp/t.webm;
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /tmp/t.webm'
```
Expected: `1470,956` (Xvnc + x11grab honour the geometry). If it fails, stop and reassess before coding. No commit for this task.

---

### Task 2: Broker — size Xvnc + recorder from the request

**Files:**
- Modify: `kasm-browser/control.py`

**Interfaces:**
- Produces: `POST /session` accepts `w`/`h`; the session's Xvnc + recorder use them (clamped, default 1280×800).

- [ ] **Step 1: Add a clamp helper**

In `kasm-browser/control.py`, add near the other module-level helpers (e.g., above `_spawn`):

```python
def _clamp_dim(v, lo, hi, default):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))
```

- [ ] **Step 2: `_spawn` takes w/h → Xvnc -geometry**

Change the `_spawn` signature and the Xvnc geometry:

```python
def _spawn(display, url, profile, home, copy_out, paste_in, w=1280, h=800):
```

```python
    xvnc = subprocess.Popen(
        ["Xvnc", disp, "-geometry", "%dx%d" % (w, h), "-depth", "24",
         "-websocketPort", str(port), "-interface", "0.0.0.0",
         "-httpd", "/usr/share/kasmvnc/www", "-SecurityTypes", "None",
         "-disableBasicAuth", "-AlwaysShared=1", send_cut, accept_cut], env=env)
```

- [ ] **Step 3: `_ffmpeg_capture` takes w/h → -video_size**

```python
def _ffmpeg_capture(display, recfile, w=1280, h=800):
```

Change the `-video_size` argument from `"1280x800"` to `"%dx%d" % (w, h)` (keep every other ffmpeg arg identical).

- [ ] **Step 4: `open_session` takes w/h + stores them**

```python
def open_session(url, copy_out, paste_in, w=1280, h=800):
```

In the body, pass w/h to `_spawn` and store them on the session dict:

```python
        procs = _spawn(display, url, profile, home, copy_out, paste_in, w, h)
        port = BASE_PORT + display
        _sessions[sid] = {"display": display, "port": port, "procs": procs,
                          "profile": profile, "home": home, "started": time.time(),
                          "w": w, "h": h}
```

- [ ] **Step 5: `POST /session` reads + clamps w/h**

In the `do_POST` `/session` handler, after `paste_in = data.get("pasteIn", True)`:

```python
            w = _clamp_dim(data.get("w"), 1024, 2560, 1280)
            h = _clamp_dim(data.get("h"), 640, 1600, 800)
            res = open_session(url, copy_out, paste_in, w, h)
```

- [ ] **Step 6: `/rec` passes the session's w/h to the recorder**

In the `do_GET` `/rec` handler, extend the session lookup and the `_ffmpeg_capture` call:

```python
            with _lock:
                sess = _sessions.get(sid)
                display = sess["display"] if sess else None
                rec_w = sess.get("w", 1280) if sess else 1280
                rec_h = sess.get("h", 800) if sess else 800
            if display is None:
                return self._json(404, {"error": "not_found"})
            recfile = "/rec/" + sid + ".webm"
            proc = _ffmpeg_capture(display, recfile, rec_w, rec_h)
```

- [ ] **Step 7: Verify Python parses**

Run: `python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add kasm-browser/control.py
git commit -m "feat(isolated): size Xvnc + recorder to the client-reported screen size"
```

---

### Task 3: Data-plane — thread the size through

**Files:**
- Modify: `dataplane/kasmtunnel.go`

**Interfaces:**
- Produces: `openKasmSession(rw, host, target, copyOut, pasteIn, w, h)`.

- [ ] **Step 1: `openKasmSession` sends w/h**

Change the signature and body:

```go
func openKasmSession(rw io.ReadWriter, host, target string, copyOut, pasteIn bool, w, h int) (id string, port, status int, err error) {
	body := `{"url":` + jsonQuoteKasm(target) +
		`,"copyOut":` + strconv.FormatBool(copyOut) +
		`,"pasteIn":` + strconv.FormatBool(pasteIn) +
		`,"w":` + strconv.Itoa(w) +
		`,"h":` + strconv.Itoa(h) + `}`
```

(The rest of `openKasmSession` is unchanged.)

- [ ] **Step 2: Add dimension helpers**

Add near the other kasm helpers in `dataplane/kasmtunnel.go`:

```go
func parseKasmDim(s string) int {
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func splitKasmSize(s string) (int, int, bool) {
	i := strings.IndexByte(s, 'x')
	if i <= 0 {
		return 0, 0, false
	}
	w, e1 := strconv.Atoi(s[:i])
	h, e2 := strconv.Atoi(s[i+1:])
	if e1 != nil || e2 != nil {
		return 0, 0, false
	}
	return w, h, true
}

func clampKasmDim(v, lo, hi, def int) int {
	if v <= 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
```

- [ ] **Step 3: `serveKasmTunnel` reads w/h + sets the cookie**

In `serveKasmTunnel`, right after the existing `ca_kasm_site` cookie-set block (`if r.URL.Query().Get("site") != "" { http.SetCookie(... ca_kasm_site ...) }`), add:

```go
	// Client-reported screen size for a full-screen desktop: query on the HTML load,
	// cookie for the query-less websockify upgrade (same pattern as ca_kasm_site).
	kasmW := parseKasmDim(r.URL.Query().Get("w"))
	kasmH := parseKasmDim(r.URL.Query().Get("h"))
	if kasmW == 0 || kasmH == 0 {
		if c, e := r.Cookie("ca_kasm_size"); e == nil {
			if cw, ch, ok := splitKasmSize(c.Value); ok {
				if kasmW == 0 {
					kasmW = cw
				}
				if kasmH == 0 {
					kasmH = ch
				}
			}
		}
	}
	if r.URL.Query().Get("w") != "" && r.URL.Query().Get("h") != "" {
		http.SetCookie(w, &http.Cookie{Name: "ca_kasm_size", Value: strconv.Itoa(kasmW) + "x" + strconv.Itoa(kasmH), Path: "/kasm-tunnel", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	}
```

- [ ] **Step 4: Pass clamped w/h to `openKasmSession`**

At the call site (currently `id, port, status, e = openKasmSession(st, d.KasmControlAddr, d.NavigateUrl, co, pi)`), add the clamped dimensions:

```go
			cw := clampKasmDim(kasmW, 1024, 2560, 1280)
			ch := clampKasmDim(kasmH, 640, 1600, 800)
			id, port, status, e = openKasmSession(st, d.KasmControlAddr, d.NavigateUrl, co, pi, cw, ch)
```

- [ ] **Step 5: Build + test**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dataplane/kasmtunnel.go
git commit -m "feat(dataplane): thread client screen size to the isolated broker"
```

---

### Task 4: Manager — measure + pass the screen size

**Files:**
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx`

**Interfaces:**
- Consumes: `/kasm-tunnel/?...&w=&h=` (Task 3).

- [ ] **Step 1: Measure the screen size + gate the iframe**

In `src/app/gateway/[siteId]/session/isolated-client.tsx`, add a `dims` state measured on mount, and render the iframe only once it is known.

Add the state + effect (near the other `useState`/`useEffect` hooks):

```tsx
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // Size the isolated desktop to the vendor's screen so browser-fullscreen fills
  // exactly (no aspect letterbox). CSS px (logical) keeps resource use reasonable on
  // Retina; clamped to sane bounds. screen (not innerWidth) so the fullscreen viewport
  // matches. The broker keeps this size fixed for the session, so recordings stay
  // correct.
  useEffect(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
    setDims({ w: clamp(window.screen.width, 1024, 2560), h: clamp(window.screen.height, 640, 1600) });
  }, []);
```

Change the iframe render to be gated on `dims` and include `w`/`h`:

```tsx
      {dims && (
        <iframe
          ref={frameRef}
          title="Isolated browser"
          src={`/kasm-tunnel/?site=${siteId}&w=${dims.w}&h=${dims.h}&${KASM_PARAMS}`}
          style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
          allow="clipboard-read; clipboard-write"
        />
      )}
```

Change the splash condition to also cover the pre-measure moment:

```tsx
      {(!ready || !dims) && <ConnectSplash siteName={siteName} />}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add "src/app/gateway/[siteId]/session/isolated-client.tsx"
git commit -m "feat(isolated): pass the vendor screen size so fullscreen fills exactly"
```

---

### Task 5: Full verification

**Files:** none.

- [ ] **Step 1: All builds green**

Run: `pnpm build && cd dataplane && go build ./... && go test ./... && cd .. && python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('py ok')"`
Expected: all PASS.

- [ ] **Step 2: Wiring grep**

Run: `grep -rn "ca_kasm_size" dataplane/kasmtunnel.go && grep -rn "screen.width" "src/app/gateway/[siteId]/session/isolated-client.tsx" && grep -rn '"-geometry", "%dx%d"' kasm-browser/control.py`
Expected: a match in each (dataplane cookie, manager measure, broker geometry).

- [ ] **Step 3: Manual Gate (record for deploy gate)**

Deferred to deploy (gateway host pulls the new kasm image):
- Connect from a MacBook, press the green button (browser fullscreen) → the isolated browser fills the screen with no letterbox.
- End cleanly → the recording is full-screen (not a quarter/letterboxed) and plays with correct duration + seek.
- External monitor still fills. Live watching (admin) + GATEWAY unchanged.
- An old client with no size still works (broker falls back to 1280×800).

---

## Self-Review

**Spec coverage:**
- Broker sizes Xvnc + recorder from w/h (clamped, default 1280×800), stored per session → Task 2. ✓
- Data-plane threads w/h (query → ca_kasm_size cookie → openKasmSession body) → Task 3. ✓
- Manager measures `screen` (clamped, CSS px) + passes w/h + gates iframe → Task 4. ✓
- resize=scale unchanged; admin viewer unchanged → not touched. ✓
- Backward-compatible fallback to 1280×800 (broker `_clamp_dim` default, dataplane `clampKasmDim` def) → Tasks 2/3. ✓
- No schema change → deploy notes. ✓

**Placeholder scan:** none — every code step is concrete; Task 1 is an explicit spike.

**Type/name consistency:** `openKasmSession(..., w, h int)` defined in Task 3 Step 1 and called in Step 4. `parseKasmDim`/`splitKasmSize`/`clampKasmDim` defined (Step 2) and used (Steps 3–4). Broker `_spawn(..., w=1280, h=800)`, `_ffmpeg_capture(display, recfile, w, h)`, `open_session(..., w, h)`, `_clamp_dim` names consistent across Task 2. Cookie name `ca_kasm_size` identical in set (Task 3) and read (Task 3). Clamp bounds identical everywhere: 1024..2560 × 640..1600, default 1280×800.
