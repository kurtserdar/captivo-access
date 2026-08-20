# Isolated Browser Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the isolated-browser (KasmVNC broker) log tail on the connector detail page, mirroring the guacd "Gateway logs" feature — plus adding the broker logging that makes it useful.

**Architecture:** Broker logs session lifecycle → tee to a shared `/kasmlog` volume → the connector tails it into a ring → reports it in `Telemetry.KasmLogs` → the data plane passes the struct through unchanged → the manager renders an "Isolated browser logs" card. Mirrors the guacd path end to end.

**Tech Stack:** Python (kasm broker), Go (connector, tunnel), Next.js/TypeScript (manager), Docker (deploy command in repair.ts).

## Global Constraints

- **Language:** English only — comments, identifiers, UI strings, commit messages (public repo).
- **No Claude signature** in commits.
- **Data plane does NOT change** — it stores/serves the whole `*tunnel.Telemetry` on the Session; adding `KasmLogs` to the struct flows through automatically.
- **Broker logs lifecycle only** — session opened/closed, capacity refused; NOT per-request HTTP, NOT Xvnc/Chromium/ffmpeg noise. Timestamp format `time.strftime("%Y/%m/%d %H:%M:%S")` + space + message, `flush=True` (matches the connector/guacd log style).
- **Mirror guacd exactly** for the tail (300-line ring, `tail(80)` reported), the shared-volume rw/ro mounts, and the UI card + hint copy.
- **Deploy + release notes are SEPARATE gates.** Spans connector + kasm-browser (connector-side) and tunnel + manager (central); the gateway-host install (repair) command must be re-run for the new volume. Data plane image unchanged.

---

## File Structure

- Modify: `kasm-browser/control.py` — `log()` helper + lifecycle log points.
- Modify: `kasm-browser/entrypoint.sh` — tee the broker output to `/kasmlog/kasm.log`.
- Modify: `kasm-browser/control_test.py` — test the `log()` formatter.
- Modify: `tunnel/controlframe.go` — add `KasmLogs []string` to `Telemetry`.
- Create: `connector/kasmlog.go` — `kasmLogRing` + `tailKasmLog` (reuses `splitLines`).
- Modify: `connector/main.go` — tail `/kasmlog/kasm.log` if `/kasmlog` exists.
- Modify: `connector/stats.go` — `KasmLogs: kasmLogRing.tail(80)`.
- Modify: `src/lib/connector/repair.ts` — `captivo_kasm_logs` volume mounts.
- Modify: `src/lib/connector/telemetry.ts` — `kasmLogs?: string[]`.
- Modify: `src/app/(app)/admin/connectors/[id]/page.tsx` — "Isolated browser logs" card.

---

### Task 1: Broker logging + tee

**Files:**
- Modify: `kasm-browser/control.py`
- Modify: `kasm-browser/entrypoint.sh`
- Test: `kasm-browser/control_test.py`

**Interfaces:**
- Produces: the broker prints timestamped lifecycle lines to stdout; the entrypoint tees them to `/kasmlog/kasm.log`. `log(msg) -> str` returns the formatted line (also prints it) so it is unit-testable.

- [ ] **Step 1: Write the failing test**

In `kasm-browser/control_test.py`, add:
```python
def test_log_format():
    line = control.log("session s1 opened", _emit=False)
    # "YYYY/MM/DD HH:MM:SS session s1 opened"
    assert line.endswith(" session s1 opened")
    assert len(line.split(" ")[0].split("/")) == 3  # date has 3 parts
```
And add `test_log_format()` to the `if __name__ == "__main__":` runner block.

- [ ] **Step 2: Run it (fail)**

Run: `cd /opt/captivo-access/kasm-browser && python3 control_test.py`
Expected: FAIL (`module 'control' has no attribute 'log'`).

- [ ] **Step 3: Add the `log()` helper**

In `kasm-browser/control.py`, after the constants (near `FT_MAX_BYTES`), add:
```python
def log(msg, _emit=True):
    # Timestamped broker log line (session lifecycle). Printed to stdout with
    # flush; the entrypoint tees stdout to /kasmlog/kasm.log so the connector can
    # tail it and the console shows "Isolated browser logs". Returns the line so it
    # is testable. Matches the guacd/connector log style (YYYY/MM/DD HH:MM:SS ...).
    line = time.strftime("%Y/%m/%d %H:%M:%S") + " " + msg
    if _emit:
        print(line, flush=True)
    return line
```

- [ ] **Step 4: Add lifecycle log points**

In `kasm-browser/control.py`:
1. In `open_session` (~line 124-140), at the capacity/display returns and on success:
```python
def open_session(url, copy_out, paste_in, w=1280, h=800, watermark_text=""):
    with _lock:
        if len(_sessions) >= MAX_SESSIONS:
            log("capacity reached (%d active) — session refused" % MAX_SESSIONS)
            return None
        display = _free_display()
        if display is None:
            log("no free display — session refused")
            return None
        _seq["n"] += 1
        sid = "s%d-%d" % (int(time.time()), _seq["n"])
        profile = "/profiles/" + sid
        home = "/sess/" + sid
        procs = _spawn(display, url, profile, home, copy_out, paste_in, w, h, watermark_text)
        port = BASE_PORT + display
        _sessions[sid] = {"display": display, "port": port, "procs": procs,
                          "profile": profile, "home": home, "started": time.time(),
                          "w": w, "h": h}
        log("session %s opened -> %s (%dx%d)" % (sid, url, w, h))
        return {"id": sid, "port": port}
```
2. Replace `close_session` (~line 143) — add the log line before the existing `_kill(sess)`:
```python
def close_session(sid):
    with _lock:
        sess = _sessions.pop(sid, None)
    if sess:
        log("session %s closed" % sid)
        _kill(sess)
```
3. In the reaper (the existing `print("kasm-broker: reaping stale session " + sid, ...)`, ~line 183), replace that print with:
```python
                log("session %s reaped (stale)" % sid)
```

- [ ] **Step 5: Tee the broker output to the volume**

In `kasm-browser/entrypoint.sh`, replace the final `exec python3 /control.py` with:
```sh
mkdir -p /kasmlog
python3 /control.py 2>&1 | tee /kasmlog/kasm.log
```

- [ ] **Step 6: Run test + byte-compile**

Run:
```bash
cd /opt/captivo-access/kasm-browser && python3 control_test.py && python3 -c "import py_compile; py_compile.compile('control.py', doraise=True)" && echo COMPILE_OK
```
Expected: prints `ok` then `COMPILE_OK`.

- [ ] **Step 7: Commit**

```bash
cd /opt/captivo-access
git add kasm-browser/control.py kasm-browser/entrypoint.sh kasm-browser/control_test.py
git commit -m "feat(isolated): broker session-lifecycle logging + tee to /kasmlog for the connector"
```

---

### Task 2: Tunnel field + connector tail + telemetry

**Files:**
- Modify: `tunnel/controlframe.go`
- Create: `connector/kasmlog.go`
- Modify: `connector/main.go`
- Modify: `connector/stats.go`

**Interfaces:**
- Consumes: `newLogRing`, `splitLines` (existing package-level helpers in `connector/`).
- Produces: `Telemetry.KasmLogs []string`; `kasmLogRing` + `tailKasmLog(path string)`; the connector reports `KasmLogs`.

- [ ] **Step 1: Add the wire field**

In `tunnel/controlframe.go`, add to the `Telemetry` struct after `GuacdLogs`:
```go
	KasmLogs          []string `json:"kasmLogs"`    // tail of the isolated-browser (KasmVNC) broker log (gateway-host connectors only)
```

- [ ] **Step 2: Create `connector/kasmlog.go`**

Mirror `guacdlog.go` (reusing the shared `splitLines`):
```go
package main

import (
	"io"
	"os"
	"time"
)

// kasmLogRing holds the tail of the isolated-browser (KasmVNC) broker log
// (gateway-host connectors only). Separate from guacdLogRing / logRingBuf so the
// console shows each source apart.
var kasmLogRing = newLogRing(300)

// tailKasmLog follows the broker log file at path, appending new lines to
// kasmLogRing. Handles truncation the same way as tailGuacdLog: `tee` truncates
// the file when the kasm container restarts, so a shrink resets the offset to 0.
// Best-effort; runs for the life of the process.
func tailKasmLog(path string) {
	var offset int64
	var remainder []byte
	for {
		time.Sleep(2 * time.Second)
		fi, err := os.Stat(path)
		if err != nil {
			continue
		}
		if fi.Size() < offset {
			offset = 0
			remainder = nil
		}
		if fi.Size() == offset {
			continue
		}
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			f.Close()
			continue
		}
		buf, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			continue
		}
		offset += int64(len(buf))
		var lines []string
		lines, remainder = splitLines(append(remainder, buf...))
		for _, line := range lines {
			kasmLogRing.Write([]byte(line))
		}
	}
}
```

- [ ] **Step 3: Start the tail in `main.go`**

In `connector/main.go`, right after the guacd tail block, add:
```go
	// On a gateway host the isolated-browser log volume is mounted at /kasmlog;
	// tail the broker log so the console can show it. Absent on non-gateway hosts.
	if _, err := os.Stat("/kasmlog"); err == nil {
		go tailKasmLog("/kasmlog/kasm.log")
	}
```

- [ ] **Step 4: Report it in telemetry**

In `connector/stats.go`, in `snapshot()`, add after `GuacdLogs`:
```go
		KasmLogs:          kasmLogRing.tail(80),
```

- [ ] **Step 5: Build + test connector + tunnel**

Run:
```bash
cd /opt/captivo-access/tunnel && go build ./... && go test ./...
cd /opt/captivo-access/connector && go build ./... && go test ./...
```
Expected: builds ok; tests pass.

- [ ] **Step 6: Commit**

```bash
cd /opt/captivo-access
git add tunnel/controlframe.go connector/kasmlog.go connector/main.go connector/stats.go
git commit -m "feat(isolated): connector tails the broker log + reports it as Telemetry.KasmLogs"
```

---

### Task 3: Deploy — shared log volume (repair.ts)

**Files:**
- Modify: `src/lib/connector/repair.ts`

**Interfaces:**
- Produces: the gateway-host install command mounts `captivo_kasm_logs` on the kasm container (rw) + the connector (ro).

- [ ] **Step 1: Mount the volume on the connector (ro)**

In `src/lib/connector/repair.ts`, in the `connector` run command, change the volume line:
```ts
    `-v access_connector_data:/data -v captivo_guacd_logs:/guaclog:ro -v captivo_guacd_drive:/drive:rw ${CONNECTOR}; `;
```
to add the kasm log volume:
```ts
    `-v access_connector_data:/data -v captivo_guacd_logs:/guaclog:ro -v captivo_guacd_drive:/drive:rw -v captivo_kasm_logs:/kasmlog:ro ${CONNECTOR}; `;
```

- [ ] **Step 2: Mount the volume on the kasm container (rw)**

In the `kasm` run command, add the volume mount:
```ts
  const kasm = `docker pull ${KASM}; docker rm -f captivo-kasm >/dev/null 2>&1; docker run -d --name captivo-kasm --restart unless-stopped --network ${NET} --shm-size=1g -v captivo_kasm_logs:/kasmlog ${KASM}`;
```

- [ ] **Step 3: Update repair test if present**

Run: `cd /opt/captivo-access && ls src/lib/connector/repair.test.ts 2>/dev/null && grep -n "guaclog\|kasmlog\|captivo_kasm" src/lib/connector/repair.test.ts`
If a test asserts the exact command string, add the `captivo_kasm_logs` mounts to the expected string(s).

- [ ] **Step 4: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK` (and `npx vitest run src/lib/connector/repair.test.ts` if it exists).
Expected: `BUILD_OK` (+ test green).

- [ ] **Step 5: Commit**

```bash
cd /opt/captivo-access
git add src/lib/connector/repair.ts src/lib/connector/repair.test.ts 2>/dev/null; git add src/lib/connector/repair.ts
git commit -m "feat(isolated): mount the captivo_kasm_logs volume on kasm + connector (gateway install)"
```

---

### Task 4: Manager UI — "Isolated browser logs" card

**Files:**
- Modify: `src/lib/connector/telemetry.ts`
- Modify: `src/app/(app)/admin/connectors/[id]/page.tsx`

**Interfaces:**
- Consumes: `Telemetry.KasmLogs` → `telemetry.kasmLogs`.
- Produces: an "Isolated browser logs" card on the connector detail page.

- [ ] **Step 1: Add the type field**

In `src/lib/connector/telemetry.ts`, in the `ConnectorTelemetry` interface, add after `guacdLogs`:
```ts
  kasmLogs?: string[];
```

- [ ] **Step 2: Add the card**

In `src/app/(app)/admin/connectors/[id]/page.tsx`, right after the "Gateway logs" card's closing `</div>`, add a mirrored card:
```tsx
      <div className="card">
        <div className="card-head"><div className="ch-title"><h2>Isolated browser logs</h2><span className="sub">Last lines from the isolated browser engine (KasmVNC)</span></div></div>
        {t && t.kasmLogs && t.kasmLogs.length > 0 ? (
          <div className="term">
            <div className="term-body" style={{ maxHeight: "18rem" }}>
              {t.kasmLogs.map((line, i) => (
                <div key={i} className={`term-line ${logLineClass(line)}`}>{line}</div>
              ))}
            </div>
          </div>
        ) : (
          <p className="cell-sub">No isolated-browser logs yet — the connector is offline, or hasn&apos;t been updated to report them (re-run its command).</p>
        )}
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 4: Commit**

```bash
cd /opt/captivo-access
git add src/lib/connector/telemetry.ts "src/app/(app)/admin/connectors/[id]/page.tsx"
git commit -m "feat(isolated): show Isolated browser logs on the connector detail page"
```

---

## Final verification (after all tasks)

- [ ] `cd /opt/captivo-access/tunnel && go build ./... && go test ./...` — green.
- [ ] `cd /opt/captivo-access/connector && go build ./... && go test ./...` — green.
- [ ] `cd /opt/captivo-access/kasm-browser && python3 control_test.py` — prints `ok`; `py_compile` clean.
- [ ] `cd /opt/captivo-access && pnpm build` — Compiled successfully; `npx vitest run src/lib/connector/` green.
- [ ] **Manual (post-deploy + gateway install re-run):** open an isolated session, then the connector detail page → "Isolated browser logs" shows the `session … opened`/`closed` lines; a non-gateway connector shows the hint.

## Release (SEPARATE GATES — do not auto-run)

After the user approves deploy: bump version, tag (CI rebuilds images incl. connector + kasm-browser + manager). Update the central manager (tunnel/manager). The connector + kasm-browser are connector-side — the operator must **re-run the gateway-host install (repair) command** so the new `captivo_kasm_logs` volume is mounted. Data plane image unchanged. On tag, add an English user-focused `gh release edit` note that calls out the gateway re-run.
