# Gateway guacd Logs on Connector Detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a gateway-host connector's guacd logs on the connector detail page, captured via a shared log volume (no docker socket) and shipped in the connector's existing telemetry.

**Architecture:** guacd writes stderr to `/guaclog/guacd.log` on a shared `captivo_guacd_logs` volume (`tee`, truncate-on-restart); the connector mounts it read-only, tails it into a bounded ring, and includes the tail in its telemetry `GuacdLogs` field; the manager renders a "Gateway logs" card beside "Recent logs".

**Tech Stack:** Go (connector + shared `tunnel` module, under `go.work`), Next.js 16 (manager), Docker, vitest.

## Global Constraints

- **English only** — every user-facing string, comment, commit message, release note.
- **No Claude signature** in commits/PRs.
- **No schema change** — nothing in `prisma/schema.prisma`; **no `access-migrate` run** on deploy.
- **guacd log level is fixed `info`** — the `guacamole/guacd:1.5.5` image default env `GUACD_LOG_LEVEL=info`; do NOT add a `-e GUACD_LOG_LEVEL` or a level control.
- **No docker socket** anywhere.
- **Verify commands:** Go build/test run **from `connector/`** (`cd connector && go build ./... && go test ./...`); the shared struct also lives in `tunnel/`. TS build `pnpm build`; TS tests `pnpm test`.
- **Only gateway-host connectors** get guacd + the log volume; non-gateway commands and UI are unchanged.
- **Deploy:** rebuild + bump `connector`, `access-dataplane` (Telemetry struct), `access-manager` (guacd command + UI). No migrate. Operators re-run the gateway-host connector command once.

---

### Task 1: Connector guacd-log tail

**Files:**
- Create: `connector/guacdlog.go`
- Test: `connector/guacdlog_test.go`

**Interfaces:**
- Consumes: the existing `logRing` type + `newLogRing` (`connector/logring.go`).
- Produces:
  - `var guacdLogRing = newLogRing(300)`
  - `func splitLines(buf []byte) (lines []string, remainder []byte)` — splits complete lines (newline-stripped, `\r` trimmed, empty lines dropped); returns the trailing partial line as remainder.
  - `func tailGuacdLog(path string)` — poll loop that tails `path` into `guacdLogRing`, handling truncation.

- [ ] **Step 1: Write the failing test**

Create `connector/guacdlog_test.go`:

```go
package main

import (
	"reflect"
	"testing"
)

func TestSplitLinesCompleteAndPartial(t *testing.T) {
	lines, rem := splitLines([]byte("alpha\nbeta\ngam"))
	if !reflect.DeepEqual(lines, []string{"alpha", "beta"}) {
		t.Fatalf("lines = %v", lines)
	}
	if string(rem) != "gam" {
		t.Fatalf("remainder = %q", rem)
	}
}

func TestSplitLinesTrailingNewlineNoRemainder(t *testing.T) {
	lines, rem := splitLines([]byte("one\ntwo\n"))
	if !reflect.DeepEqual(lines, []string{"one", "two"}) || len(rem) != 0 {
		t.Fatalf("lines=%v rem=%q", lines, rem)
	}
}

func TestSplitLinesDropsEmptyAndTrimsCR(t *testing.T) {
	lines, _ := splitLines([]byte("a\r\n\nb\n"))
	if !reflect.DeepEqual(lines, []string{"a", "b"}) {
		t.Fatalf("lines = %v", lines)
	}
}

func TestSplitLinesRemainderCarriesForward(t *testing.T) {
	_, rem := splitLines([]byte("par"))
	lines, rem2 := splitLines(append(rem, []byte("tial\ndone\n")...))
	if !reflect.DeepEqual(lines, []string{"partial", "done"}) || len(rem2) != 0 {
		t.Fatalf("lines=%v rem=%q", lines, rem2)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd connector && go test ./... -run TestSplitLines`
Expected: FAIL — `splitLines` undefined (does not compile).

- [ ] **Step 3: Implement `connector/guacdlog.go`**

```go
package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"time"
)

// guacdLogRing holds the tail of guacd's log (gateway-host connectors only).
// Separate from logRingBuf so the console shows guacd and connector logs apart.
var guacdLogRing = newLogRing(300)

// splitLines splits buf into complete lines (newline-stripped, trailing \r
// trimmed, empty lines dropped) and returns any trailing partial line as the
// remainder to prepend to the next read.
func splitLines(buf []byte) (lines []string, remainder []byte) {
	for {
		i := bytes.IndexByte(buf, '\n')
		if i < 0 {
			return lines, buf
		}
		line := strings.TrimRight(string(buf[:i]), "\r")
		if line != "" {
			lines = append(lines, line)
		}
		buf = buf[i+1:]
	}
}

// tailGuacdLog follows the guacd log file at path, appending new lines to
// guacdLogRing. It handles truncation: `tee` (in the bundled guacd command)
// truncates the file when guacd restarts, so when the file shrinks below the
// read offset the offset is reset to 0. Best-effort — any I/O error just retries
// on the next tick. Runs for the life of the process.
func tailGuacdLog(path string) {
	var offset int64
	var remainder []byte
	for {
		time.Sleep(2 * time.Second)
		fi, err := os.Stat(path)
		if err != nil {
			continue // not present yet
		}
		if fi.Size() < offset {
			offset = 0 // truncated: guacd restarted
			remainder = nil
		}
		if fi.Size() == offset {
			continue // nothing new
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
			guacdLogRing.Write([]byte(line))
		}
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd connector && go test ./... -run TestSplitLines`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add connector/guacdlog.go connector/guacdlog_test.go
git commit -m "feat(connector): tail guacd's log file into a bounded ring (gateway hosts)"
```

---

### Task 2: Ship guacd logs in telemetry

**Files:**
- Modify: `tunnel/controlframe.go`
- Modify: `connector/stats.go`
- Modify: `connector/main.go`

**Interfaces:**
- Consumes: `guacdLogRing` + `tailGuacdLog` (Task 1).
- Produces: `Telemetry.GuacdLogs []string` (JSON `guacdLogs`); the connector starts the tail when `/guaclog` is mounted and reports the tail every telemetry cycle.

- [ ] **Step 1: Add the `GuacdLogs` field to the shared Telemetry struct**

In `tunnel/controlframe.go`, add the field right after `RecentLogs`:

```go
	RecentLogs        []string `json:"recentLogs"`  // tail of the connector's own log output
	GuacdLogs         []string `json:"guacdLogs"`   // tail of guacd's log (gateway-host connectors only)
```

- [ ] **Step 2: Populate it in the connector snapshot**

In `connector/stats.go`, in `snapshot()`, add the field after `RecentLogs`:

```go
		RecentLogs:        logRingBuf.tail(80),
		GuacdLogs:         guacdLogRing.tail(80),
```

- [ ] **Step 3: Start the tail when the guacd log volume is mounted**

In `connector/main.go`, right after `go logHeartbeat()`:

```go
	go logHeartbeat()
	// On a gateway host the guacd log volume is mounted at /guaclog; tail guacd's
	// log so the console can show it. On non-gateway hosts /guaclog is absent and
	// the tail never starts (guacdLogRing stays empty).
	if _, err := os.Stat("/guaclog"); err == nil {
		go tailGuacdLog("/guaclog/guacd.log")
	}
```

(`os` is already imported in `main.go`.)

- [ ] **Step 4: Verify the connector build + tests**

Run: `cd connector && go build ./... && go test ./... && cd ..`
Expected: PASS (build clean; Task 1 tests + existing tests green).

- [ ] **Step 5: Verify the data-plane still builds against the changed struct**

Run: `cd dataplane && go build ./... && cd ..`
Expected: PASS (the data-plane forwards `Telemetry` unchanged; it only needs to compile against the new field).

- [ ] **Step 6: Commit**

```bash
git add tunnel/controlframe.go connector/stats.go connector/main.go
git commit -m "feat(connector): report guacd log tail in telemetry (GuacdLogs)"
```

---

### Task 3: Bundle guacd log capture into the connector command

**Files:**
- Modify: `src/lib/connector/repair.ts`
- Test: `src/lib/connector/repair.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the gateway-host command runs guacd with a `tee` to `/guaclog/guacd.log` on the `captivo_guacd_logs` volume, and mounts that volume read-only on the connector.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/connector/repair.test.ts`, inside the existing `describe("gateway-host bundles guacd", ...)` block (after the last `it`):

```ts
  it("gateway install captures guacd logs to a shared volume", () => {
    const cmd = buildInstallCommand("CODE123", m, t, true);
    expect(cmd).toContain("-v captivo_guacd_logs:/guaclog ");
    expect(cmd).toContain("tee /guaclog/guacd.log");
    expect(cmd).toContain("-v captivo_guacd_logs:/guaclog:ro");
  });
  it("non-gateway install has no guacd log volume", () => {
    const cmd = buildInstallCommand("CODE123", m, t, false);
    expect(cmd).not.toContain("captivo_guacd_logs");
    expect(cmd).not.toContain("/guaclog");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/connector/repair.test.ts`
Expected: FAIL — the new assertions fail (command lacks the log volume + tee).

- [ ] **Step 3: Update the guacd + connector run in `runCommand`**

In `src/lib/connector/repair.ts`, change the `guacd` block's `docker run` for guacd to add the log volume + `tee` CMD:

```ts
  const guacd = gatewayHost
    ? `docker network inspect ${GATEWAY_NETWORK} >/dev/null 2>&1 || docker network create ${GATEWAY_NETWORK} && ` +
      `docker run --rm -v captivo_guacd_recordings:/rec busybox chown -R 1000:1000 /rec && ` +
      `docker rm -f captivo-guacd >/dev/null 2>&1; ` +
      `docker run -d --name captivo-guacd --restart unless-stopped --network ${GATEWAY_NETWORK} ` +
      `-v captivo_guacd_recordings:/recordings -v captivo_guacd_logs:/guaclog ` +
      `guacamole/guacd:1.5.5 /bin/sh -c '/opt/guacamole/sbin/guacd -b 0.0.0.0 -L $GUACD_LOG_LEVEL -f 2>&1 | tee /guaclog/guacd.log' && `
    : "";
```

Then, in the connector `docker run` returned below, mount the same volume read-only on gateway hosts — add the line right after `-v access_connector_data:/data `:

```ts
    "-v access_connector_data:/data " +
    (gatewayHost ? "-v captivo_guacd_logs:/guaclog:ro " : "") +
    "ghcr.io/kurtserdar/captivo-access-connector:latest"
```

Notes for the implementer:
- The guacd CMD override replicates the image's own CMD (`guacd -b 0.0.0.0 -L $GUACD_LOG_LEVEL -f`) and appends `2>&1 | tee /guaclog/guacd.log`. `$GUACD_LOG_LEVEL` stays single-quoted so the OUTER shell (the operator's paste) does not expand it — the container's shell expands it from the image env (`info`). The `| tee` pipe is inside the single-quoted container CMD, so it does not interact with the outer command's `&&`/`;`/`||`.
- Do NOT add `-e GUACD_LOG_LEVEL` (fixed `info` via the image default).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/connector/repair.test.ts`
Expected: PASS (all repair tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connector/repair.ts src/lib/connector/repair.test.ts
git commit -m "feat(gateway): capture guacd logs to a shared volume in the connector command"
```

---

### Task 4: "Gateway logs" card on the connector detail page

**Files:**
- Modify: `src/lib/connector/telemetry.ts`
- Modify: `src/app/(app)/admin/connectors/[id]/page.tsx`

**Interfaces:**
- Consumes: `ConnectorTelemetry` (add `guacdLogs`), `connector.gatewayHost` (already in the page's `select`), `logLineClass` (already defined in the page), `t` (the telemetry object).
- Produces: a "Gateway logs" card shown only for gateway-host connectors.

> No unit test (presentational server component). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Add `guacdLogs` to the telemetry type**

In `src/lib/connector/telemetry.ts`, in `interface ConnectorTelemetry`, add after `recentLogs`:

```ts
  recentLogs?: string[];
  guacdLogs?: string[];
```

- [ ] **Step 2: Render the "Gateway logs" card**

In `src/app/(app)/admin/connectors/[id]/page.tsx`, immediately after the existing "Recent logs" `<div className="card">…</div>` block, add:

```tsx
      {connector.gatewayHost && (
        <div className="card">
          <div className="card-head"><div className="ch-title"><h2>Gateway logs</h2><span className="sub">Last lines from guacd (remote-desktop engine)</span></div></div>
          {t && t.guacdLogs && t.guacdLogs.length > 0 ? (
            <div className="term">
              <div className="term-body" style={{ maxHeight: "18rem" }}>
                {t.guacdLogs.map((line, i) => (
                  <div key={i} className={`term-line ${logLineClass(line)}`}>{line}</div>
                ))}
              </div>
            </div>
          ) : (
            <p className="cell-sub">No guacd logs yet — the connector is offline, or hasn&apos;t been updated to report gateway logs (re-run its command).</p>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/connector/telemetry.ts "src/app/(app)/admin/connectors/[id]/page.tsx"
git commit -m "feat(gateway): show guacd logs on the connector detail page"
```

- [ ] **Step 5: Gate A — live validation (operator, after deploy)**

Manual acceptance, after deploy (bump connector + data-plane + manager; operator re-runs the gateway-host connector command once). Confirm:

1. On a **gateway-host** connector that has run at least one RDP session, open
   `/admin/connectors/[id]` → a **"Gateway logs"** card appears with guacd's
   connection lines (alongside "Recent logs").
2. Trigger a failure on a Remote desktop site (e.g. wrong target host) → the
   guacd error line shows up in the card.
3. On a **non-gateway** connector, no "Gateway logs" card is shown.
4. Restart guacd (re-run the command) → the card keeps working (no stale/dup
   lines after the `tee` truncation).

---

## Self-Review

**1. Spec coverage:**
- guacd command `tee` → `captivo_guacd_logs` volume + connector `:ro` mount → Task 3. ✓
- Connector tail (`guacdLogRing`, `tailGuacdLog`, truncation) → Task 1. ✓
- Telemetry `GuacdLogs` + populate + start-if-`/guaclog` → Task 2. ✓
- Manager "Gateway logs" card (gateway-host only, empty state) + TS type → Task 4. ✓
- Fixed `info` level (no `-e`, no control) → Task 3 notes. ✓
- No schema change / no migrate; deploy + re-run → Global Constraints + Task 4 Gate A. ✓
- Edge cases (non-gateway empty, missing file, truncation) → Task 1 (`tailGuacdLog`) + Task 2 (start gate) + Task 4 (card gate). ✓

**2. Placeholder scan:** No TBD/TODO; every code step carries real code. The one untested task (UI card) states the justification (presentational server component), consistent with the repo's other detail-page cards.

**3. Type consistency:**
- `Telemetry.GuacdLogs` (Go, JSON `guacdLogs`, Task 2) matches `ConnectorTelemetry.guacdLogs` (TS, Task 4) and `t.guacdLogs` in the card. ✓
- `guacdLogRing`/`tailGuacdLog`/`splitLines` (Task 1) are consumed exactly by Task 2 (`snapshot`, `main.go`). ✓
- The `-v captivo_guacd_logs:/guaclog` (guacd) / `:ro` (connector) volume name and the `/guaclog/guacd.log` path (Task 3) match `tailGuacdLog("/guaclog/guacd.log")` and the `/guaclog` start gate (Tasks 1–2). ✓
- `connector.gatewayHost` and `logLineClass` used in Task 4 already exist in the page (`select` includes `gatewayHost`; `logLineClass` is defined). ✓
