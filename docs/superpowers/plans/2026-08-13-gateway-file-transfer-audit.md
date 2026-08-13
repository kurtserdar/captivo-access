# Gateway File-Transfer Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every file uploaded/downloaded through the Guacamole gateway as a tamper-evident row in the existing access-audit hash chain.

**Architecture:** A passive observer in the data-plane parses a *copy* of each guac instruction on both tunnel pumps (never mutating the relayed bytes), tracks open file streams keyed by `(direction, streamIndex)`, and emits an `AuditEvent` on `end` (completed) or at session teardown (partial). Events flow through the unchanged `AuditQueue → /api/internal/audit/log → appendAuditEvents` pipeline. Transfer details map onto columns already inside the frozen `canonicalize`, so nothing about the chain changes. The manager adds a badge + a "File transfers only" filter to the Access-audit table.

**Tech Stack:** Go (data-plane, `dataplane/`), TypeScript/Next.js + Prisma 7 (manager, `src/`), vitest.

## Global Constraints

- **English only** — all code, comments, commit messages (public OSS repo).
- **No Claude signature** in commits (no `Co-Authored-By`, no "Generated with").
- **Do NOT touch** `src/lib/audit/chain.ts` `canonicalize`, its field set, `AUDIT_CHAIN_LOCK_KEY`, or the anchor code — changing any invalidates every existing hash + RFC-3161 anchor.
- **No Prisma schema change**, no migrate, no connector rebuild. Ships as **v0.40.0** (manager + dataplane only).
- **The four transfer verbs are a single source of truth**: `DOWNLOAD`, `UPLOAD`, `DOWNLOAD-PARTIAL`, `UPLOAD-PARTIAL`. Defined once in Go, once in TS (`access-format.ts`), and every other TS file imports them.
- **Forwarding path stays byte-identical** — the observer parses a copy and never alters relayed bytes.
- Data-plane tests: `cd dataplane && go test ./...`. Manager tests: `pnpm test`. Typecheck: `pnpm build`.

---

### Task 1: Data-plane observer core (pure state machine)

**Files:**
- Create: `dataplane/guacfiletransfer.go`
- Test: `dataplane/guacfiletransfer_test.go`

**Interfaces:**
- Consumes: `AuditEvent` (`dataplane/audit.go`), `parseInstruction(*bufio.Reader) (string, []string, error)` (`dataplane/guacproto.go`).
- Produces:
  - `type xferDir int` with `dirDownload xferDir = 0`, `dirUpload xferDir = 1`.
  - `func newFTObserver(userID, siteID, host, clientIP, userAgent string) *ftObserver`
  - `func (o *ftObserver) observe(dir xferDir, raw []byte) []AuditEvent`
  - `func (o *ftObserver) flush() []AuditEvent`
  - Verb constants `verbDownload`, `verbUpload`, `verbDownloadPartial`, `verbUploadPartial`.

- [ ] **Step 1: Write the failing test**

Create `dataplane/guacfiletransfer_test.go`:

```go
package main

import (
	"testing"
	"time"
)

func fixedObs() *ftObserver {
	o := newFTObserver("u1", "s1", "10.0.0.5", "203.0.113.7", "Mozilla/5.0")
	o.now = func() time.Time { return time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) }
	return o
}

func TestObserveDownloadFileComplete(t *testing.T) {
	o := fixedObs()
	// file,<idx>,<mime>,<name>
	if evs := o.observe(dirDownload, encodeInstruction("file", "3", "application/pdf", "report.pdf")); len(evs) != 0 {
		t.Fatalf("file open should not emit, got %d", len(evs))
	}
	// base64("hi") = "aGk=" -> 2 bytes
	o.observe(dirDownload, encodeInstruction("blob", "3", "aGk="))
	evs := o.observe(dirDownload, encodeInstruction("end", "3"))
	if len(evs) != 1 {
		t.Fatalf("end should emit 1 event, got %d", len(evs))
	}
	e := evs[0]
	if e.Method != verbDownload || e.Path != "/report.pdf" || e.BytesOut != 2 ||
		e.Status != 200 || e.Decision != "ALLOW" || e.Reason != "file:application/pdf" ||
		e.UserID != "u1" || e.SiteID != "s1" || e.Host != "10.0.0.5" ||
		e.ClientIP != "203.0.113.7" || e.UserAgent != "Mozilla/5.0" {
		t.Fatalf("unexpected event: %+v", e)
	}
}

func TestObserveUploadPutComplete(t *testing.T) {
	o := fixedObs()
	// put,<fsIdx>,<idx>,<mime>,<name>  (upload into a filesystem)
	o.observe(dirUpload, encodeInstruction("put", "0", "7", "text/plain", "notes.txt"))
	o.observe(dirUpload, encodeInstruction("blob", "7", "YWJj")) // base64("abc") = 3 bytes
	evs := o.observe(dirUpload, encodeInstruction("end", "7"))
	if len(evs) != 1 || evs[0].Method != verbUpload || evs[0].Path != "/notes.txt" || evs[0].BytesOut != 3 {
		t.Fatalf("unexpected upload event: %+v", evs)
	}
}

func TestObserveBodyDownload(t *testing.T) {
	o := fixedObs()
	// body,<fsIdx>,<idx>,<mime>,<name>  (download out of a filesystem)
	o.observe(dirDownload, encodeInstruction("body", "0", "9", "image/png", "logo.png"))
	o.observe(dirDownload, encodeInstruction("blob", "9", "YQ==")) // base64("a") = 1 byte
	evs := o.observe(dirDownload, encodeInstruction("end", "9"))
	if len(evs) != 1 || evs[0].Method != verbDownload || evs[0].Path != "/logo.png" || evs[0].BytesOut != 1 {
		t.Fatalf("unexpected body event: %+v", evs)
	}
}

func TestObservePartialFlush(t *testing.T) {
	o := fixedObs()
	o.observe(dirDownload, encodeInstruction("file", "1", "application/zip", "big.zip"))
	o.observe(dirDownload, encodeInstruction("blob", "1", "YWJj")) // 3 bytes, no end
	evs := o.flush()
	if len(evs) != 1 || evs[0].Method != verbDownloadPartial || evs[0].Status != 499 ||
		evs[0].BytesOut != 3 || evs[0].Reason != "file-transfer-aborted" {
		t.Fatalf("unexpected partial event: %+v", evs)
	}
	// flush is idempotent: streams were consumed
	if evs2 := o.flush(); len(evs2) != 0 {
		t.Fatalf("second flush should be empty, got %d", len(evs2))
	}
}

func TestObserveInterleavedStreams(t *testing.T) {
	o := fixedObs()
	o.observe(dirDownload, encodeInstruction("file", "1", "text/plain", "a.txt"))
	o.observe(dirDownload, encodeInstruction("file", "2", "text/plain", "b.txt"))
	o.observe(dirDownload, encodeInstruction("blob", "1", "YWJj")) // a.txt += 3
	o.observe(dirDownload, encodeInstruction("blob", "2", "YWk=")) // base64("ai") = 2
	e1 := o.observe(dirDownload, encodeInstruction("end", "1"))
	e2 := o.observe(dirDownload, encodeInstruction("end", "2"))
	if len(e1) != 1 || e1[0].Path != "/a.txt" || e1[0].BytesOut != 3 {
		t.Fatalf("stream 1 wrong: %+v", e1)
	}
	if len(e2) != 1 || e2[0].Path != "/b.txt" || e2[0].BytesOut != 2 {
		t.Fatalf("stream 2 wrong: %+v", e2)
	}
}

func TestObserveSameIndexDifferentDirection(t *testing.T) {
	o := fixedObs()
	// same stream index 5 on both directions must be independent
	o.observe(dirDownload, encodeInstruction("file", "5", "text/plain", "down.txt"))
	o.observe(dirUpload, encodeInstruction("file", "5", "text/plain", "up.txt"))
	d := o.observe(dirDownload, encodeInstruction("end", "5"))
	u := o.observe(dirUpload, encodeInstruction("end", "5"))
	if len(d) != 1 || d[0].Method != verbDownload || d[0].Path != "/down.txt" {
		t.Fatalf("download side wrong: %+v", d)
	}
	if len(u) != 1 || u[0].Method != verbUpload || u[0].Path != "/up.txt" {
		t.Fatalf("upload side wrong: %+v", u)
	}
}

func TestObserveIgnoresNonTransferOpcodes(t *testing.T) {
	o := fixedObs()
	if evs := o.observe(dirUpload, encodeInstruction("mouse", "640", "480", "1")); len(evs) != 0 {
		t.Fatalf("mouse should emit nothing, got %d", len(evs))
	}
	if evs := o.observe(dirDownload, encodeInstruction("sync", "12345")); len(evs) != 0 {
		t.Fatalf("sync should emit nothing, got %d", len(evs))
	}
	// unknown/duplicate end for an untracked stream is a no-op
	if evs := o.observe(dirDownload, encodeInstruction("end", "99")); len(evs) != 0 {
		t.Fatalf("unknown end should emit nothing, got %d", len(evs))
	}
}

func TestObserveMultipleInstructionsInOneMessage(t *testing.T) {
	o := fixedObs()
	// browser->guacd frames can concatenate instructions in one WS message
	msg := append(encodeInstruction("file", "4", "text/plain", "c.txt"), encodeInstruction("blob", "4", "YWJj")...)
	msg = append(msg, encodeInstruction("end", "4")...)
	evs := o.observe(dirUpload, msg)
	if len(evs) != 1 || evs[0].Path != "/c.txt" || evs[0].BytesOut != 3 {
		t.Fatalf("concatenated message wrong: %+v", evs)
	}
}

func TestObserveStreamCap(t *testing.T) {
	o := fixedObs()
	for i := 0; i < maxOpenStreams+50; i++ {
		o.observe(dirDownload, encodeInstruction("file", itoa(i), "text/plain", "f.txt"))
	}
	if got := len(o.streams); got != maxOpenStreams {
		t.Fatalf("expected cap %d open streams, got %d", maxOpenStreams, got)
	}
}

func TestB64DecodedLen(t *testing.T) {
	cases := map[string]int64{"": 0, "YWJj": 3, "aGk=": 2, "YQ==": 1, "YWk=": 2}
	for in, want := range cases {
		if got := b64DecodedLen(in); got != want {
			t.Fatalf("b64DecodedLen(%q) = %d, want %d", in, got, want)
		}
	}
}
```

Note: `itoa` is a tiny test helper — add at the bottom of the test file:

```go
func itoa(i int) string { return strconv.Itoa(i) }
```

and add `"strconv"` to the test file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dataplane && go test ./... -run TestObserve`
Expected: FAIL — `undefined: newFTObserver` / `undefined: dirDownload` etc.

- [ ] **Step 3: Write the implementation**

Create `dataplane/guacfiletransfer.go`:

```go
package main

import (
	"bufio"
	"bytes"
	"io"
	"sync"
	"time"
)

// Transfer verbs stored in AuditEvent.Method. These are the single source of
// truth on the Go side; the TS side mirrors them in src/lib/audit/access-format.ts.
const (
	verbDownload        = "DOWNLOAD"
	verbUpload          = "UPLOAD"
	verbDownloadPartial = "DOWNLOAD-PARTIAL"
	verbUploadPartial   = "UPLOAD-PARTIAL"
)

// maxOpenStreams bounds per-session memory: a malicious client that opens
// endless file streams without ever sending `end` cannot exhaust memory. Beyond
// the cap, new stream opens are ignored.
const maxOpenStreams = 256

// maxFilenameLen caps the filename stored in AuditEvent.Path.
const maxFilenameLen = 512

type xferDir int

const (
	dirDownload xferDir = 0
	dirUpload   xferDir = 1
)

type ftKey struct {
	dir xferDir
	idx string
}

type ftStream struct {
	filename string
	mimetype string
	bytes    int64
}

// ftObserver watches guac file-transfer opcodes on both tunnel directions and
// produces AuditEvents. It is safe for the two pump goroutines to call observe
// concurrently (one per direction) plus flush at teardown.
type ftObserver struct {
	mu        sync.Mutex
	userID    string
	siteID    string
	host      string
	clientIP  string
	userAgent string
	streams   map[ftKey]*ftStream
	now       func() time.Time
}

func newFTObserver(userID, siteID, host, clientIP, userAgent string) *ftObserver {
	return &ftObserver{
		userID: userID, siteID: siteID, host: host,
		clientIP: clientIP, userAgent: userAgent,
		streams: make(map[ftKey]*ftStream),
		now:     time.Now,
	}
}

// observe parses a COPY of one WS message / instruction (which may contain
// several concatenated instructions) and returns any AuditEvents finalized by
// an `end`. It never mutates raw. Parse errors are swallowed (best-effort audit).
func (o *ftObserver) observe(dir xferDir, raw []byte) []AuditEvent {
	br := bufio.NewReader(bytes.NewReader(raw))
	var out []AuditEvent
	o.mu.Lock()
	defer o.mu.Unlock()
	for {
		op, args, err := parseInstruction(br)
		if err == io.EOF || err != nil {
			return out
		}
		switch op {
		case "file": // file,<idx>,<mime>,<name>
			if len(args) >= 3 {
				o.open(dir, args[0], args[2], args[1])
			}
		case "put", "body": // put/body,<fsIdx>,<idx>,<mime>,<name>
			if len(args) >= 4 {
				o.open(dir, args[1], args[3], args[2])
			}
		case "blob": // blob,<idx>,<base64>
			if len(args) >= 2 {
				if st := o.streams[ftKey{dir, args[0]}]; st != nil {
					st.bytes += b64DecodedLen(args[1])
				}
			}
		case "end": // end,<idx>
			if len(args) >= 1 {
				k := ftKey{dir, args[0]}
				if st := o.streams[k]; st != nil {
					out = append(out, o.event(dir, st, false))
					delete(o.streams, k)
				}
			}
		}
	}
}

func (o *ftObserver) open(dir xferDir, idx, filename, mimetype string) {
	if len(o.streams) >= maxOpenStreams {
		return
	}
	o.streams[ftKey{dir, idx}] = &ftStream{filename: filename, mimetype: mimetype}
}

// flush finalizes every still-open stream as a partial/aborted transfer and
// clears the map. Called once at session teardown.
func (o *ftObserver) flush() []AuditEvent {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []AuditEvent
	for k, st := range o.streams {
		out = append(out, o.event(k.dir, st, true))
	}
	o.streams = make(map[ftKey]*ftStream)
	return out
}

func (o *ftObserver) event(dir xferDir, st *ftStream, partial bool) AuditEvent {
	method := verbDownload
	if dir == dirUpload {
		method = verbUpload
	}
	status := 200
	reason := "file:" + st.mimetype
	if partial {
		if dir == dirUpload {
			method = verbUploadPartial
		} else {
			method = verbDownloadPartial
		}
		status = 499
		reason = "file-transfer-aborted"
	}
	name := st.filename
	if len(name) > maxFilenameLen {
		name = name[:maxFilenameLen]
	}
	return AuditEvent{
		Timestamp: o.now(),
		UserID:    o.userID,
		SiteID:    o.siteID,
		Host:      o.host,
		Method:    method,
		Path:      "/" + name,
		Status:    status,
		BytesOut:  st.bytes,
		Decision:  "ALLOW",
		Reason:    reason,
		ClientIP:  o.clientIP,
		UserAgent: o.userAgent,
	}
}

// b64DecodedLen returns the number of bytes a standard base64 string decodes to,
// computed from its length and trailing padding without allocating a decode buffer.
func b64DecodedLen(s string) int64 {
	n := len(s)
	if n == 0 {
		return 0
	}
	pad := 0
	if s[n-1] == '=' {
		pad++
		if n >= 2 && s[n-2] == '=' {
			pad++
		}
	}
	return int64(n/4*3 - pad)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd dataplane && go test ./... -run 'TestObserve|TestB64'`
Expected: PASS (all observer + base64 tests).

- [ ] **Step 5: Commit**

```bash
git add dataplane/guacfiletransfer.go dataplane/guacfiletransfer_test.go
git commit -m "feat(gateway): file-transfer observer state machine"
```

---

### Task 2: Wire the observer into the tunnel

**Files:**
- Modify: `dataplane/guactunnel.go` (signature, both pump goroutines, teardown flush, capture clientIp/userAgent)
- Modify: `dataplane/main.go:261` (pass the audit queue)

**Interfaces:**
- Consumes: `newFTObserver`, `(*ftObserver).observe`, `(*ftObserver).flush`, `dirDownload`, `dirUpload` (Task 1); `AuditQueue.Enqueue(AuditEvent)` (`dataplane/audit.go`); `firstHop(string) string` (`dataplane/browserproxy.go`).

- [ ] **Step 1: Change the tunnel signature to accept the queue**

In `dataplane/guactunnel.go`, change the function signature (line ~30):

```go
func serveGuacTunnel(ctrl *ControlClient, reg *Registry, hub *SessionHub, audit *AuditQueue, w http.ResponseWriter, r *http.Request) {
```

- [ ] **Step 2: Update the caller in main.go**

In `dataplane/main.go` (line ~261), change:

```go
	mux.HandleFunc("/guac-tunnel", func(w http.ResponseWriter, r *http.Request) { serveGuacTunnel(ctrl, reg, hub, audit, w, r) })
```

(`audit` is already in scope — it is created at `main.go:248` and passed to `BrowserProxy` just above.)

- [ ] **Step 3: Create the observer after the descriptor is known**

In `dataplane/guactunnel.go`, immediately after the successful `GatewayDescriptor` call (after line ~55, the `descriptor ok` log), add:

```go
	ft := newFTObserver(userID, siteID, conn.Hostname, firstHop(r.Header.Get("X-Forwarded-For")), r.UserAgent())
```

- [ ] **Step 4: Feed both pumps and flush at teardown**

In the `guacd -> browser` goroutine, after the `rec.Write(inst)` block and before `c.Write(...)`, add:

```go
			for _, ev := range ft.observe(dirDownload, inst) {
				audit.Enqueue(ev)
			}
```

In the `browser -> guacd` goroutine, inside the `if !ls.vendorInputAllowed() { continue }` guard's success path — i.e. after that check and before/after `guac.Write(data)` — add:

```go
			for _, ev := range ft.observe(dirUpload, data) {
				audit.Enqueue(ev)
			}
```

(Placing it after the `vendorInputAllowed` check means uploads dropped while an admin holds control are correctly not counted — the bytes never reach guacd.)

After the `<-errc` line (session teardown), before the function returns, add:

```go
	for _, ev := range ft.flush() {
		audit.Enqueue(ev)
	}
```

- [ ] **Step 5: Verify it builds and existing tests pass**

Run: `cd dataplane && go build ./... && go vet ./... && go test ./...`
Expected: builds clean, vet clean, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add dataplane/guactunnel.go dataplane/main.go
git commit -m "feat(gateway): emit file-transfer audit events from the tunnel"
```

---

### Task 3: Manager — access-format helper + verb constants

**Files:**
- Create: `src/lib/audit/access-format.ts`
- Test: `src/lib/audit/access-format.test.ts`

**Interfaces:**
- Produces:
  - `export const TRANSFER_VERBS = ["DOWNLOAD", "UPLOAD", "DOWNLOAD-PARTIAL", "UPLOAD-PARTIAL"] as const;`
  - `export type TransferBadge = { isTransfer: boolean; direction?: "download" | "upload"; partial?: boolean; label?: string };`
  - `export function transferBadge(method: string): TransferBadge`

- [ ] **Step 1: Write the failing test**

Create `src/lib/audit/access-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transferBadge, TRANSFER_VERBS } from "./access-format";

describe("transferBadge", () => {
  it("maps DOWNLOAD", () => {
    expect(transferBadge("DOWNLOAD")).toEqual({ isTransfer: true, direction: "download", partial: false, label: "Download" });
  });
  it("maps UPLOAD", () => {
    expect(transferBadge("UPLOAD")).toEqual({ isTransfer: true, direction: "upload", partial: false, label: "Upload" });
  });
  it("maps DOWNLOAD-PARTIAL as partial", () => {
    expect(transferBadge("DOWNLOAD-PARTIAL")).toEqual({ isTransfer: true, direction: "download", partial: true, label: "Download (partial)" });
  });
  it("maps UPLOAD-PARTIAL as partial", () => {
    expect(transferBadge("UPLOAD-PARTIAL")).toEqual({ isTransfer: true, direction: "upload", partial: true, label: "Upload (partial)" });
  });
  it("treats a normal HTTP method as not a transfer", () => {
    expect(transferBadge("GET")).toEqual({ isTransfer: false });
  });
  it("TRANSFER_VERBS holds exactly the four verbs", () => {
    expect([...TRANSFER_VERBS]).toEqual(["DOWNLOAD", "UPLOAD", "DOWNLOAD-PARTIAL", "UPLOAD-PARTIAL"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/audit/access-format.test.ts`
Expected: FAIL — cannot find module `./access-format`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/audit/access-format.ts`:

```ts
// The four verbs stored in AuditEvent.method for gateway file transfers. Single
// source of truth on the TS side; the Go side mirrors these in
// dataplane/guacfiletransfer.go. Keep the two in sync.
export const TRANSFER_VERBS = ["DOWNLOAD", "UPLOAD", "DOWNLOAD-PARTIAL", "UPLOAD-PARTIAL"] as const;

export type TransferBadge = {
  isTransfer: boolean;
  direction?: "download" | "upload";
  partial?: boolean;
  label?: string;
};

// Maps an AuditEvent.method to a badge descriptor. Non-transfer methods (real
// HTTP verbs from the browser proxy) return { isTransfer: false }.
export function transferBadge(method: string): TransferBadge {
  switch (method) {
    case "DOWNLOAD":
      return { isTransfer: true, direction: "download", partial: false, label: "Download" };
    case "UPLOAD":
      return { isTransfer: true, direction: "upload", partial: false, label: "Upload" };
    case "DOWNLOAD-PARTIAL":
      return { isTransfer: true, direction: "download", partial: true, label: "Download (partial)" };
    case "UPLOAD-PARTIAL":
      return { isTransfer: true, direction: "upload", partial: true, label: "Upload (partial)" };
    default:
      return { isTransfer: false };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/lib/audit/access-format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/access-format.ts src/lib/audit/access-format.test.ts
git commit -m "feat(audit): access-format transfer badge helper + verbs"
```

---

### Task 4: Manager — `kind=file` filter

**Files:**
- Modify: `src/lib/audit/query.ts` (add `kind` to the `AuditFilter` type)
- Modify: `src/lib/audit/filter.ts` (`buildAuditWhere` + `parseAuditFilter`)
- Test: `src/lib/audit/filter.test.ts` (extend)

**Interfaces:**
- Consumes: `TRANSFER_VERBS` (Task 3).
- Produces: `AuditFilter.kind?: "file"`; `buildAuditWhere` emits `where.method = { in: [...TRANSFER_VERBS] }` when `kind === "file"`; `parseAuditFilter` reads `?kind=file`.

- [ ] **Step 1: Add `kind` to the AuditFilter type**

In `src/lib/audit/query.ts`, add one field to the `AuditFilter` type (after `decision?`):

```ts
  kind?: "file";
```

- [ ] **Step 2: Write the failing test**

In `src/lib/audit/filter.test.ts`, add:

```ts
import { TRANSFER_VERBS } from "./access-format";

describe("buildAuditWhere kind", () => {
  it("kind=file filters method to the four transfer verbs", () => {
    const where = buildAuditWhere({ kind: "file", limit: 50, offset: 0 });
    expect(where.method).toEqual({ in: [...TRANSFER_VERBS] });
  });
  it("no kind means no method filter", () => {
    const where = buildAuditWhere({ limit: 50, offset: 0 });
    expect(where.method).toBeUndefined();
  });
});

describe("parseAuditFilter kind", () => {
  it("reads kind=file", () => {
    const f = parseAuditFilter(new URLSearchParams("kind=file"), { defaultLimit: 50, maxLimit: 500 });
    expect(f.kind).toBe("file");
  });
  it("ignores other kind values", () => {
    const f = parseAuditFilter(new URLSearchParams("kind=bogus"), { defaultLimit: 50, maxLimit: 500 });
    expect(f.kind).toBeUndefined();
  });
});
```

(If `buildAuditWhere` / `parseAuditFilter` are not already imported at the top of the test file, add them to the existing import from `./filter`.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- src/lib/audit/filter.test.ts`
Expected: FAIL — `where.method` undefined for `kind=file`; `f.kind` undefined.

- [ ] **Step 4: Implement the filter**

In `src/lib/audit/filter.ts`, add the import at the top:

```ts
import { TRANSFER_VERBS } from "./access-format";
```

In `buildAuditWhere`, after the `if (filter.decision) ...` line, add:

```ts
  if (filter.kind === "file") where.method = { in: [...TRANSFER_VERBS] };
```

In `parseAuditFilter`, after the `decision` parse line, add:

```ts
  const kind = sp.get("kind") === "file" ? "file" : undefined;
```

and include `kind` in the returned object:

```ts
  return { q, userId, siteId, decision, kind, from, to, limit, offset };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- src/lib/audit/filter.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit/query.ts src/lib/audit/filter.ts src/lib/audit/filter.test.ts
git commit -m "feat(audit): kind=file filter for the access log"
```

---

### Task 5: Manager — table badge + "File transfers only" toggle

**Files:**
- Modify: `src/app/(app)/admin/audit/audit-table.tsx`

**Interfaces:**
- Consumes: `transferBadge` (Task 3); the `kind=file` query param honored server-side (Task 4).

- [ ] **Step 1: Import the helper**

At the top of `src/app/(app)/admin/audit/audit-table.tsx`, add:

```tsx
import { transferBadge } from "@/lib/audit/access-format";
```

- [ ] **Step 2: Add `kind` to the Filters type + param plumbing**

In the `Filters` type (around line 31, where `decision` is), add:

```tsx
  kind: "" | "file";
```

In `buildParams`, after the `decision` line, add:

```tsx
  if (filters.kind) params.set("kind", filters.kind);
```

In `filtersFromParams`, add to the returned object:

```tsx
    kind: sp.get("kind") === "file" ? "file" : "",
```

- [ ] **Step 3: Add the toggle control to the filter bar**

In the filter bar (near the decision `<select>`, around line 191), add a checkbox field:

```tsx
        <div className="field">
          <label className="field-label" htmlFor="audit-filter-kind">Type</label>
          <label className="checkbox-inline">
            <input
              id="audit-filter-kind"
              type="checkbox"
              checked={filters.kind === "file"}
              onChange={(e) => updateFilter("kind", e.target.checked ? "file" : "")}
            />
            File transfers only
          </label>
        </div>
```

- [ ] **Step 4: Render the badge in the Request cell**

Replace the Request cell body (the `<span className="cell-truncate" ...>{r.method} {r.path}</span>` at line ~276) with a transfer-aware version:

```tsx
                  <td className="cell-sub">
                    {(() => {
                      const b = transferBadge(r.method);
                      return b.isTransfer ? (
                        <span className="ft-cell">
                          <span className={`ft-badge ${b.direction}${b.partial ? " partial" : ""}`}>
                            {b.direction === "download" ? "↓" : "↑"} {b.label}
                          </span>
                          <span className="cell-truncate" title={r.path}>{r.path}</span>
                          <CopyButton value={`${b.label}: ${r.path}`} label="Copy" />
                        </span>
                      ) : (
                        <span className="ft-cell">
                          <span className="cell-truncate" title={`${r.method} ${r.path}`}>{r.method} {r.path}</span>
                          <CopyButton value={`${r.method} ${r.path}`} label="Copy" />
                        </span>
                      );
                    })()}
                  </td>
```

- [ ] **Step 5: Add the badge styles**

Append to `src/app/globals.css`:

```css
.ft-cell { display: inline-flex; align-items: center; gap: 8px; }
.ft-badge { font-size: .72rem; font-weight: 600; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.ft-badge.download { color: var(--accent); background: var(--accent-soft, rgba(60,130,246,.12)); }
.ft-badge.upload { color: var(--ok); background: var(--ok-soft); }
.ft-badge.partial { color: var(--danger); background: var(--danger-soft); }
.checkbox-inline { display: inline-flex; align-items: center; gap: 6px; font-size: .85rem; }
```

- [ ] **Step 6: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/admin/audit/audit-table.tsx" src/app/globals.css
git commit -m "feat(audit): file-transfer badge + filter in the access log table"
```

---

### Task 6: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Data-plane** — Run: `cd dataplane && go build ./... && go vet ./... && go test ./...` → all PASS.
- [ ] **Step 2: Manager suite** — Run: `pnpm test` → PASS (existing + access-format + filter).
- [ ] **Step 3: Manager build** — Run: `pnpm build` → Compiles.
- [ ] **Step 4: Confirm list route + export inherit `kind` (read-only check).** Open `src/app/api/admin/audit/route.ts` and `src/app/api/admin/audit/export/route.ts`; verify both build their filter via `parseAuditFilter(...)` and pass it to `listAuditEvents` / `buildAuditWhere`. No code change expected — this confirms `kind=file` flows to both the table API and CSV export for free. If either route parses params by hand instead of `parseAuditFilter`, add the `kind` passthrough there and note it.
- [ ] **Step 5: Manual (Gate A, after deploy):**
  1. Start an RDP-drive session; upload a file → an `UPLOAD` row appears in Audit log → Access with the ↑ badge, correct filename in `path`, and non-zero size.
  2. Download a file from the drive → a `DOWNLOAD` row with the ↓ badge and correct size.
  3. Toggle **File transfers only** → only the transfer rows remain; export CSV → the same rows.
  4. Start a large download and disconnect mid-file → a `DOWNLOAD-PARTIAL` (amber) row with bytes-so-far.
  5. Click **Verify chain** on the Access tab → still ✓ intact (the transfers are inside the chain).

---

## Notes for the implementer

- **Never** change `chain.ts` `canonicalize` or the anchor code. The transfer data rides on existing columns precisely to avoid that.
- Keep the forwarding bytes untouched — the observer reads a copy (`bytes.NewReader(raw)`); it must never re-encode or forward parsed data.
- Deploy is **v0.40.0, manager + dataplane only**: bump both image tags in the prod compose, `docker compose pull` + `docker compose up -d access-manager access-dataplane`. **No** `access-migrate` run (no schema change). **No** connector rebuild. After deploy, verify `/login` → 200 and run Gate A.
- Both `src/app/api/admin/audit/route.ts` and `.../export/route.ts` already build their filter via `parseAuditFilter` → `listAuditEvents` → `buildAuditWhere` (verified), so `kind=file` reaches the table API and CSV export with no route change. Task 6 Step 4 just confirms this.
- The Request-cell IIFE in Task 5 is a plain inline expression; if you prefer, lift it into a small `RequestCell` component in the same file — behavior must be identical. Do not add lint suppressions.
```
