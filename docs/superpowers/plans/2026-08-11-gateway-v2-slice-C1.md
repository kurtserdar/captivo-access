# Gateway v2 — Slice C1: Native Session Recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record native gateway (RDP/SSH/VNC) sessions by teeing the guacd→browser instruction stream in the data-plane, storing it AES-256-GCM-encrypted + gzipped in Postgres, and replaying it with `Guacamole.SessionRecording` on the admin recordings page.

**Architecture:** The data-plane's `serveGuacTunnel` already relays the full guacd→browser Guacamole instruction stream on the manager host. When a site's `record` flag is set, a `recWriter` tees that stream and POSTs 256 KiB / 2 s chunks to a new `internal/recording/ingest-guac` endpoint, which stores each as `encryptBytes(gzip(raw))` in the existing `SessionRecording`/`RecordingChunk` tables (discriminated by a new `format` enum). Replay assembles + decrypts the chunks into one Blob fed to `Guacamole.SessionRecording`.

**Tech Stack:** Next.js 16 (App Router, server components), Prisma 7 (`db push`, no migrations), Go 1.2x data-plane (under `go.work`), guacamole-common-js, vitest, Postgres 16.

## Global Constraints

- **English only** — every user-facing string, comment, commit message, and GitHub Release note is English (this is a public OSS repo).
- **No Claude signature** — do NOT add `Co-Authored-By: Claude` or "Generated with" lines to commits or PRs.
- **Encryption key env is `ENCRYPTION_KEY`** (32-byte hex / 64 chars), read by the private `key()` in `src/lib/crypto.ts` — reuse it; do NOT invent a new key or env.
- **Schema uses `prisma db push`** (no migration files). After editing `prisma/schema.prisma`, run `pnpm db:generate` locally; on deploy bump BOTH `access-manager` AND `access-migrate` images and run `docker compose run --rm access-migrate`.
- **Capability gate:** native recording requires `RECORDING_ENABLED` (`recordingEnabled()`) AND per-site `recordSessions`. Consent uses `resolvedRecordingConsentRequired()`.
- **Do not break legacy rrweb recordings** — they are `format=RRWEB, encrypted=false`; every read path must still serve them.
- **Flush cadence:** 256 KiB (`262144`) or 2 s. **Size cap:** `RECORDING_MAX_BYTES` env, default `524288000` (500 MiB).
- **Verify commands:** TS build `pnpm build`; TS tests `pnpm test`; Go build `go build ./...` and Go tests `go test ./...` run **from `dataplane/`** (modules are under `go.work`).
- **`src/generated/` regen noise:** `pnpm db:generate` rewrites `src/generated/prisma/*`. Stage those together with the schema change; if they change without a schema change, `git checkout -- src/generated` to discard.

---

### Task 1: `encryptBytes` / `decryptBytes` in crypto.ts

**Files:**
- Modify: `src/lib/crypto.ts`
- Test: `src/lib/crypto.test.ts` (create)

**Interfaces:**
- Consumes: the existing private `key(): Buffer` in `crypto.ts` (reads `ENCRYPTION_KEY`).
- Produces: `encryptBytes(plaintext: Buffer): Buffer` (layout `iv(12) | tag(16) | ciphertext`), `decryptBytes(payload: Buffer): Buffer` (throws on tamper / short input).

- [ ] **Step 1: Write the failing test**

Create `src/lib/crypto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptBytes, decryptBytes } from "./crypto";

beforeAll(() => {
  // 32-byte hex key for AES-256-GCM.
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});

describe("encryptBytes/decryptBytes", () => {
  it("round-trips arbitrary binary data", () => {
    const raw = Buffer.from([0, 1, 2, 255, 254, 10, 13, 0, 128]);
    const enc = encryptBytes(raw);
    expect(enc.equals(raw)).toBe(false); // actually encrypted
    expect(decryptBytes(enc).equals(raw)).toBe(true);
  });

  it("produces a fresh IV each call (ciphertext differs)", () => {
    const raw = Buffer.from("same input");
    expect(encryptBytes(raw).equals(encryptBytes(raw))).toBe(false);
  });

  it("throws on a tampered payload", () => {
    const enc = encryptBytes(Buffer.from("secret"));
    enc[enc.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptBytes(enc)).toThrow();
  });

  it("throws on a too-short payload", () => {
    expect(() => decryptBytes(Buffer.alloc(10))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/crypto.test.ts`
Expected: FAIL — `encryptBytes`/`decryptBytes` are not exported.

- [ ] **Step 3: Add the Buffer pair to `src/lib/crypto.ts`**

Append (the module-private `key()` is already defined above these):

```ts
/** AES-256-GCM for binary data. Layout: iv(12) | tag(16) | ciphertext (raw, no base64). */
export function encryptBytes(plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptBytes(payload: Buffer): Buffer {
  if (payload.length < 28) throw new Error("Encrypted data is corrupted");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ct = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts src/lib/crypto.test.ts
git commit -m "feat(crypto): binary encryptBytes/decryptBytes (AES-256-GCM) for recording chunks"
```

---

### Task 2: Schema — `RecordingFormat` enum + `format`/`protocol`/`encrypted`

**Files:**
- Modify: `prisma/schema.prisma`
- Modify (regenerated): `src/generated/prisma/*` (via `pnpm db:generate`)

**Interfaces:**
- Produces: `RecordingFormat` enum (`RRWEB`, `GUAC`); `SessionRecording.format` (default `RRWEB`), `SessionRecording.protocol` (`String?`), `SessionRecording.encrypted` (`Boolean` default `false`).

- [ ] **Step 1: Add the enum**

In `prisma/schema.prisma`, add near the other enums (enum bodies MUST be multi-line — single-line fails to parse in this project):

```prisma
enum RecordingFormat {
  RRWEB
  GUAC
}
```

- [ ] **Step 2: Add the three fields to `SessionRecording`**

In the `model SessionRecording { ... }` block, add alongside the existing fields (before the `@@index` lines):

```prisma
  format       RecordingFormat  @default(RRWEB)
  protocol     String?
  encrypted    Boolean          @default(false)
```

- [ ] **Step 3: Push the schema and regenerate the client**

Run:
```bash
cd packages 2>/dev/null; cd /opt/captivo-access
pnpm db:generate
```
(If a local DB is reachable for a real push, `pnpm db:push` too; otherwise `db:generate` is enough to compile — prod applies it via `access-migrate`.)
Expected: Prisma client regenerates with no errors; `SessionRecording` now has `format`/`protocol`/`encrypted`.

- [ ] **Step 4: Verify the build typechecks the new fields**

Run: `pnpm build`
Expected: BUILD succeeds (no code uses the fields yet; this confirms the schema + client are valid).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/generated
git commit -m "feat(recording): SessionRecording format/protocol/encrypted for native recordings"
```

---

### Task 3: `assemble-guac` — serialize + assemble chunk helpers

**Files:**
- Create: `src/lib/recording/assemble-guac.ts`
- Test: `src/lib/recording/assemble-guac.test.ts`

**Interfaces:**
- Consumes: `encryptBytes`/`decryptBytes` from `@/lib/crypto` (Task 1).
- Produces:
  - `serializeGuacChunk(raw: Buffer): Buffer` — `encryptBytes(gzip(raw))`, the exact bytes stored in `RecordingChunk.data`.
  - `assembleGuac(chunks: { seq: number; data: Buffer | Uint8Array }[], encrypted: boolean): Buffer` — sort by seq, (decrypt if `encrypted`) + gunzip each, concat raw guac bytes; corrupt chunks skipped.

- [ ] **Step 1: Write the failing test**

Create `src/lib/recording/assemble-guac.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { serializeGuacChunk, assembleGuac } from "./assemble-guac";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});

describe("assemble-guac", () => {
  it("round-trips a single chunk", () => {
    const raw = Buffer.from("4.size,4.1024,3.768,2.96;5.ready,4.$abc;");
    const stored = serializeGuacChunk(raw);
    expect(assembleGuac([{ seq: 0, data: stored }], true).equals(raw)).toBe(true);
  });

  it("concatenates chunks in seq order regardless of input order", () => {
    const a = Buffer.from("3.aaa;");
    const b = Buffer.from("3.bbb;");
    const c = Buffer.from("3.ccc;");
    const chunks = [
      { seq: 2, data: serializeGuacChunk(c) },
      { seq: 0, data: serializeGuacChunk(a) },
      { seq: 1, data: serializeGuacChunk(b) },
    ];
    expect(assembleGuac(chunks, true).equals(Buffer.concat([a, b, c]))).toBe(true);
  });

  it("skips a corrupt chunk instead of throwing", () => {
    const good = serializeGuacChunk(Buffer.from("3.xyz;"));
    const chunks = [
      { seq: 0, data: good },
      { seq: 1, data: Buffer.from("not encrypted garbage") },
    ];
    expect(assembleGuac(chunks, true).equals(Buffer.from("3.xyz;"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/recording/assemble-guac.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/recording/assemble-guac.ts`**

```ts
import { gzipSync, gunzipSync } from "node:zlib";
import { encryptBytes, decryptBytes } from "@/lib/crypto";

// One stored RecordingChunk for a GUAC recording = encryptBytes(gzip(raw guac
// instruction bytes)). Keep this the single definition of the on-disk format so
// the ingest writer and the replay reader can never drift.
export function serializeGuacChunk(raw: Buffer): Buffer {
  return encryptBytes(gzipSync(raw));
}

// Reverse of serializeGuacChunk across a whole recording: order chunks by seq,
// (decrypt if the recording is encrypted) + gunzip each, and concatenate the raw
// guac instruction bytes into one Buffer. A chunk that fails to decode is skipped
// — a single corrupt chunk must never break the whole replay.
export function assembleGuac(
  chunks: { seq: number; data: Buffer | Uint8Array }[],
  encrypted: boolean,
): Buffer {
  const parts: Buffer[] = [];
  for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) {
    try {
      const buf = Buffer.from(c.data);
      const gz = encrypted ? decryptBytes(buf) : buf;
      parts.push(gunzipSync(gz));
    } catch {
      /* skip a corrupt chunk */
    }
  }
  return Buffer.concat(parts);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/recording/assemble-guac.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/assemble-guac.ts src/lib/recording/assemble-guac.test.ts
git commit -m "feat(recording): guac chunk serialize/assemble (encrypt+gzip round-trip)"
```

---

### Task 4: `ingest-guac` route

**Files:**
- Create: `src/app/api/internal/recording/ingest-guac/route.ts`

**Interfaces:**
- Consumes: `serializeGuacChunk` (Task 3); `recordingEnabled()` (`@/lib/recording/enabled`); `SessionRecording.format/protocol/encrypted` (Task 2).
- Produces: `POST /api/internal/recording/ingest-guac` — `DATAPLANE_SECRET`-gated; body `{ recordingKey, seq, siteId, userId, host, protocol, data(base64 raw guac bytes) }`; upserts a `SessionRecording(format=GUAC, encrypted=true)` and appends a `RecordingChunk`.

> **No unit test for this task.** Route handlers in this repo are not unit-tested (they need a live DB — the existing rrweb `ingest` route has no test either). The on-disk format is already covered by Task 3's round-trip test, and end-to-end behavior is covered by Gate A (Task 9). The deliverable is verified by `pnpm build`.

- [ ] **Step 1: Implement the route**

Create `src/app/api/internal/recording/ingest-guac/route.ts` (mirrors the shape of the existing `src/app/api/internal/recording/ingest/route.ts`, but stores raw guac bytes, not JSON events):

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";
import { serializeGuacChunk } from "@/lib/recording/assemble-guac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

interface IngestGuacBody {
  recordingKey?: string;
  seq?: number;
  siteId?: string;
  userId?: string;
  host?: string;
  protocol?: string;
  data?: string; // base64 raw guac instruction bytes
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return NextResponse.json({ error: "not found" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as IngestGuacBody;
    const recordingKey = body.recordingKey;
    if (!recordingKey || !body.data) return new NextResponse(null, { status: 204 });

    const raw = Buffer.from(body.data, "base64");
    if (raw.length === 0) return new NextResponse(null, { status: 204 });

    const stored = serializeGuacChunk(raw);
    const seq = typeof body.seq === "number" ? body.seq : 0;

    await db.$transaction(async (tx) => {
      const rec = await tx.sessionRecording.upsert({
        where: { recordingKey },
        create: {
          recordingKey,
          userId: body.userId ?? "",
          siteId: body.siteId ?? "",
          host: body.host ?? "",
          format: "GUAC",
          encrypted: true,
          protocol: body.protocol ?? null,
          eventCount: 1,
          bytes: stored.length,
          lastEventAt: new Date(),
        },
        update: {
          eventCount: { increment: 1 },
          bytes: { increment: stored.length },
          lastEventAt: new Date(),
        },
      });

      await tx.recordingChunk.create({
        data: { recordingId: rec.id, seq, data: stored },
      });
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Best-effort: recording must never throw back to the data-plane.
    console.error("[recording/ingest-guac] failed to store chunk:", err);
    return new NextResponse(null, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: BUILD succeeds; the route typechecks against the Task 2 schema fields.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/internal/recording/ingest-guac/route.ts
git commit -m "feat(recording): internal ingest-guac endpoint (encrypted guac chunks)"
```

---

### Task 5: Descriptor `record` flag (manager + data-plane contract)

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`
- Modify: `dataplane/controlclient.go`
- Modify: `dataplane/guactunnel.go` (caller of the changed signature)

**Interfaces:**
- Consumes: `recordingEnabled()`; `Site.recordSessions` (Task 2 unrelated — this field already exists).
- Produces: descriptor JSON gains `record: boolean`; Go `GatewayDescriptor` returns an extra `record bool`: new signature `GatewayDescriptor(userID, siteID string) (conn GuacConn, guacdAddress, connectorID string, record bool, err error)`.

- [ ] **Step 1: Add `record` to the descriptor route**

In `src/app/api/internal/gateway/descriptor/route.ts`:
- add the import `import { recordingEnabled } from "@/lib/recording/enabled";`
- add `recordSessions: true` to the `site` `select`
- add `record: recordingEnabled() && site.recordSessions,` to the returned `NextResponse.json({ ... })`

Resulting select + return (only the changed lines shown; keep the rest):

```ts
const site = await db.site.findUnique({
  where: { id: siteId },
  select: { accessMode: true, connectorId: true, recordSessions: true },
});
// ... existing gateway/grant/vault checks unchanged ...
return NextResponse.json({
  protocol: cred.protocol.toLowerCase(),
  targetHost: cred.targetHost,
  targetPort: cred.targetPort,
  username: cred.username,
  secret: cred.secret,
  secretKind: cred.secretKind,
  guacdAddress: (process.env.GUACD_ADDR ?? "captivo-guacd:4822").trim(),
  connectorId: site.connectorId,
  record: recordingEnabled() && site.recordSessions,
});
```

- [ ] **Step 2: Add `Record` to the Go descriptor**

In `dataplane/controlclient.go`, `GatewayDescriptor`:
- add `Record bool \`json:"record"\`` to the anonymous `out` struct
- change the signature to return `record bool` and thread it through both `return` statements:

```go
func (c *ControlClient) GatewayDescriptor(userID, siteID string) (conn GuacConn, guacdAddress, connectorID string, record bool, err error) {
	var out struct {
		Protocol     string `json:"protocol"`
		TargetHost   string `json:"targetHost"`
		TargetPort   int    `json:"targetPort"`
		Username     string `json:"username"`
		Secret       string `json:"secret"`
		SecretKind   string `json:"secretKind"`
		GuacdAddress string `json:"guacdAddress"`
		ConnectorID  string `json:"connectorId"`
		Record       bool   `json:"record"`
	}
	if err := c.post("/api/internal/gateway/descriptor", map[string]string{"userId": userID, "siteId": siteID}, &out); err != nil {
		return GuacConn{}, "", "", false, err
	}
	return GuacConn{
		Protocol:   out.Protocol,
		Hostname:   out.TargetHost,
		Port:       strconv.Itoa(out.TargetPort),
		Username:   out.Username,
		Secret:     out.Secret,
		SecretKind: out.SecretKind,
	}, out.GuacdAddress, out.ConnectorID, out.Record, nil
}
```

- [ ] **Step 3: Update the caller in `guactunnel.go`**

In `serveGuacTunnel`, change:
```go
conn, guacdAddr, connectorID, err := ctrl.GatewayDescriptor(userID, siteID)
```
to:
```go
conn, guacdAddr, connectorID, record, err := ctrl.GatewayDescriptor(userID, siteID)
```
Then, immediately after the existing successful-descriptor `log.Printf`, add:
```go
_ = record // consumed in Task 6 (tee wiring)
```
(The throwaway keeps the build green in this task; Task 6 replaces it with real use.)

- [ ] **Step 4: Verify both builds**

Run: `pnpm build`
Expected: PASS.
Run (from `dataplane/`): `cd dataplane && go build ./... && cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/internal/gateway/descriptor/route.ts dataplane/controlclient.go dataplane/guactunnel.go
git commit -m "feat(gateway): descriptor record flag (RECORDING_ENABLED && site.recordSessions)"
```

---

### Task 6: Data-plane tee — `recWriter` + wire into `serveGuacTunnel`

**Files:**
- Create: `dataplane/guacrecord.go`
- Test: `dataplane/guacrecord_test.go`
- Modify: `dataplane/guactunnel.go`

**Interfaces:**
- Consumes: `ControlClient.BaseURL`, `ControlClient.Secret` (both exported fields); the `record bool` from Task 5; `POST /api/internal/recording/ingest-guac` (Task 4).
- Produces: `newRecWriter(managerURL, secret, key, siteID, userID, host, protocol string, capBytes int) *recWriter`; methods `Write(inst []byte)`, `Close()`; `recordingMaxBytes() int`; `newRecordingKey(siteID, userID string) string`.

- [ ] **Step 1: Write the failing Go test**

Create `dataplane/guacrecord_test.go`:

```go
package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestRecWriterFlushesOnByteThreshold(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(b))
		mu.Unlock()
		w.WriteHeader(204)
	}))
	defer srv.Close()

	w := newRecWriter(srv.URL, "sekret", "key1", "site1", "user1", "host1", "rdp", 10*1024*1024)
	// One instruction over the 256 KiB flush threshold forces a flush.
	big := []byte(strings.Repeat("A", 300*1024))
	w.Write(big)
	w.Close()

	mu.Lock()
	defer mu.Unlock()
	if len(bodies) == 0 {
		t.Fatalf("expected at least one ingest POST, got 0")
	}
	if !strings.Contains(bodies[0], `"recordingKey":"key1"`) || !strings.Contains(bodies[0], `"protocol":"rdp"`) {
		t.Fatalf("first body missing expected fields: %s", bodies[0][:min(200, len(bodies[0]))])
	}
}

func TestRecWriterStopsAtSizeCap(t *testing.T) {
	var mu sync.Mutex
	count := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		count++
		mu.Unlock()
		w.WriteHeader(204)
	}))
	defer srv.Close()

	// Cap of 256 KiB: the first 300 KiB write flushes once, then total > cap stops capture.
	w := newRecWriter(srv.URL, "sekret", "key2", "s", "u", "h", "ssh", 256*1024)
	w.Write([]byte(strings.Repeat("B", 300*1024))) // flush #1, total now 300 KiB > cap
	w.Write([]byte(strings.Repeat("C", 300*1024))) // dropped (capped)
	w.Close()

	mu.Lock()
	defer mu.Unlock()
	if count != 1 {
		t.Fatalf("expected exactly 1 POST before cap, got %d", count)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `dataplane/`): `cd dataplane && go test ./... -run TestRecWriter`
Expected: FAIL — `newRecWriter` undefined (does not compile).

- [ ] **Step 3: Implement `dataplane/guacrecord.go`**

```go
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

const (
	recFlushBytes           = 256 * 1024
	recFlushInterval        = 2 * time.Second
	recDefaultMaxBytes      = 524288000 // 500 MiB
)

// recordingMaxBytes is the per-recording cumulative (pre-gzip) byte cap. Past it,
// capture stops but the live session continues.
func recordingMaxBytes() int {
	if v := os.Getenv("RECORDING_MAX_BYTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return recDefaultMaxBytes
}

// newRecordingKey builds a globally-unique key for one session recording.
func newRecordingKey(siteID, userID string) string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%s-%s-%d-%s", siteID, userID, time.Now().UnixNano(), hex.EncodeToString(b[:]))
}

// recWriter tees a guacd->browser Guacamole instruction stream to the manager's
// ingest-guac endpoint in 256 KiB / 2 s chunks. It is single-goroutine (called
// only from the guacd->browser relay loop) so it needs no locking. Every method
// is best-effort: a failed POST or a reached size cap never blocks the session.
type recWriter struct {
	managerURL string
	secret     string
	key        string
	siteID     string
	userID     string
	host       string
	protocol   string
	capBytes   int

	buf       bytes.Buffer
	seq       int
	total     int
	lastFlush time.Time
	stopped   bool
	client    *http.Client
}

func newRecWriter(managerURL, secret, key, siteID, userID, host, protocol string, capBytes int) *recWriter {
	return &recWriter{
		managerURL: managerURL,
		secret:     secret,
		key:        key,
		siteID:     siteID,
		userID:     userID,
		host:       host,
		protocol:   protocol,
		capBytes:   capBytes,
		lastFlush:  time.Now(),
		client:     &http.Client{Timeout: 10 * time.Second},
	}
}

// Write appends one whole guac instruction and flushes when the buffer reaches
// recFlushBytes or recFlushInterval has elapsed. Once the cumulative byte total
// exceeds capBytes, capture stops (logged once) and further writes are dropped.
func (w *recWriter) Write(inst []byte) {
	if w.stopped {
		return
	}
	if w.total >= w.capBytes {
		log.Printf("recording site=%s key=%s: size cap reached, stopping capture", w.siteID, w.key)
		w.stopped = true
		return
	}
	w.buf.Write(inst)
	w.total += len(inst)
	if w.buf.Len() >= recFlushBytes || time.Since(w.lastFlush) >= recFlushInterval {
		w.flush()
	}
}

// flush POSTs the buffered bytes as one chunk. On any error it logs and drops the
// chunk (advancing seq) — a missing chunk is a small replay gap, never a broken
// session. On success the buffer is reset.
func (w *recWriter) flush() {
	if w.buf.Len() == 0 {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"recordingKey": w.key,
		"seq":          w.seq,
		"siteId":       w.siteID,
		"userId":       w.userID,
		"host":         w.host,
		"protocol":     w.protocol,
		"data":         base64.StdEncoding.EncodeToString(w.buf.Bytes()),
	})
	w.seq++
	w.buf.Reset()
	w.lastFlush = time.Now()
	if err != nil {
		log.Printf("recording key=%s: marshal failed err=%v", w.key, err)
		return
	}
	req, err := http.NewRequest(http.MethodPost, w.managerURL+"/api/internal/recording/ingest-guac", bytes.NewReader(payload))
	if err != nil {
		log.Printf("recording key=%s: build request failed err=%v", w.key, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", w.secret)
	resp, err := w.client.Do(req)
	if err != nil {
		log.Printf("recording key=%s seq=%d: ingest post failed err=%v", w.key, w.seq-1, err)
		return
	}
	resp.Body.Close()
}

// Close flushes the tail chunk.
func (w *recWriter) Close() {
	w.flush()
}
```

> Note the `min` helper is defined in the test file; if your Go toolchain is 1.21+ `min` is a builtin — in that case delete the `func min` from the test to avoid a redeclaration error.

- [ ] **Step 4: Run the test to verify it passes**

Run (from `dataplane/`): `cd dataplane && go test ./... -run TestRecWriter`
Expected: PASS (2 tests). If a `min` redeclaration error appears, remove `func min` from the test file (builtin on Go ≥1.21) and re-run.

- [ ] **Step 5: Wire the tee into `serveGuacTunnel`**

In `dataplane/guactunnel.go`, replace the throwaway `_ = record` from Task 5 and instrument the guacd→browser goroutine.

First, right after the `log.Printf("guac-tunnel site=%s: READY, bridging", siteID)` line (before `websocket.Accept`), create the writer:

```go
	var rec *recWriter
	if record {
		rec = newRecWriter(ctrl.BaseURL, ctrl.Secret, newRecordingKey(siteID, userID), siteID, userID, conn.Hostname, conn.Protocol, recordingMaxBytes())
		defer rec.Close()
		log.Printf("guac-tunnel site=%s: recording enabled key=%s", siteID, rec.key)
	}
```

Then, in the existing guacd→browser goroutine, tee each instruction. Change:

```go
	go func() {
		for {
			inst, rerr := readRawInstruction(br)
			if rerr != nil {
				errc <- rerr
				return
			}
			if werr := c.Write(ctx, websocket.MessageText, inst); werr != nil {
				errc <- werr
				return
			}
		}
	}()
```

to:

```go
	go func() {
		for {
			inst, rerr := readRawInstruction(br)
			if rerr != nil {
				errc <- rerr
				return
			}
			if rec != nil {
				rec.Write(inst)
			}
			if werr := c.Write(ctx, websocket.MessageText, inst); werr != nil {
				errc <- werr
				return
			}
		}
	}()
```

(`defer rec.Close()` runs on function return — after `<-errc` — flushing the tail.)

- [ ] **Step 6: Verify the data-plane build + full Go tests**

Run (from `dataplane/`): `cd dataplane && go build ./... && go test ./... && cd ..`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dataplane/guacrecord.go dataplane/guacrecord_test.go dataplane/guactunnel.go
git commit -m "feat(gateway): tee guacd stream to ingest-guac when recording is enabled"
```

---

### Task 7: Serve route `/api/admin/recordings/[id]/guac`

**Files:**
- Create: `src/app/api/admin/recordings/[id]/guac/route.ts`

**Interfaces:**
- Consumes: `assembleGuac` (Task 3); `can(role, "configure")` + `getCurrentUser()` (existing guard, mirror `.../[id]/events/route.ts`); `SessionRecording.format/encrypted` (Task 2).
- Produces: `GET /api/admin/recordings/:id/guac` → the assembled raw guac instruction bytes as `application/octet-stream` (404 if not found or not a GUAC recording).

> **No unit test** (admin-guarded DB route, like the sibling `events` route which has none). The byte format is covered by Task 3; end-to-end replay is Gate A. Verified by `pnpm build`.

- [ ] **Step 1: Implement the route**

Create `src/app/api/admin/recordings/[id]/guac/route.ts` (mirrors `src/app/api/admin/recordings/[id]/events/route.ts`):

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { assembleGuac } from "@/lib/recording/assemble-guac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({ where: { id } });
  if (!rec || rec.format !== "GUAC") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const chunks = await db.recordingChunk.findMany({
    where: { recordingId: id },
    orderBy: { seq: "asc" },
    select: { seq: true, data: true },
  });
  const blob = assembleGuac(
    chunks.map((c) => ({ seq: c.seq, data: Buffer.from(c.data) })),
    rec.encrypted,
  );

  return new NextResponse(new Uint8Array(blob), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(blob.length),
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/recordings/[id]/guac/route.ts"
git commit -m "feat(recording): serve assembled guac recording bytes to admins"
```

---

### Task 8: Replay UI — detail-page branch, guac player, list badge

**Files:**
- Create: `src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx`
- Modify: `src/app/(app)/admin/recordings/[id]/page.tsx`
- Modify: `src/app/(app)/admin/recordings/recordings-table.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/recordings/:id/guac` (Task 7); `SessionRecording.format`/`protocol` (Task 2); `guacamole-common-js` (already a dependency; the ambient `declare module` types it as `any`, so no `.d.ts` change is needed).
- Produces: `<GuacRecordingPlayer recordingId={string} />`.

- [ ] **Step 1: Implement the guac player**

Create `src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx`. It fetches the recording as a Blob and drives `Guacamole.SessionRecording`. guacamole-common-js is typed as `any` here (matching `session-client.tsx`).

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function GuacRecordingPlayer({ recordingId }: { recordingId: string }) {
  const displayRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/recordings/${recordingId}/guac`);
        if (!res.ok) { setError("Couldn't load this recording."); return; }
        const blob = await res.blob();
        if (blob.size === 0) { setEmpty(true); return; }
        if (disposed || !displayRef.current) return;

        const Guacamole: any = (await import("guacamole-common-js")).default ?? (await import("guacamole-common-js"));
        const recording = new Guacamole.SessionRecording(blob);
        recRef.current = recording;

        const display = recording.getDisplay();
        displayRef.current.innerHTML = "";
        displayRef.current.appendChild(display.getElement());

        recording.onprogress = (total: number) => setDuration(total);
        recording.onseek = (millis: number) => setPosition(millis);
        recording.onplay = () => setPlaying(true);
        recording.onpause = () => setPlaying(false);

        recording.connect();
      } catch {
        setError("Couldn't play this recording.");
      }
    })();
    return () => {
      disposed = true;
      try { recRef.current?.disconnect?.(); } catch { /* ignore */ }
      recRef.current = null;
    };
  }, [recordingId]);

  function toggle() {
    const r = recRef.current;
    if (!r) return;
    if (playing) r.pause();
    else r.play();
  }
  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const r = recRef.current;
    if (!r) return;
    const millis = Number(e.target.value);
    r.seek(millis, () => setPosition(millis));
  }

  if (error) return <p className="notice error">{error}</p>;
  if (empty) return <p className="notice">This recording is empty.</p>;

  return (
    <div className="guac-recording">
      <div ref={displayRef} className="guac-recording-display" />
      <div className="guac-recording-controls">
        <button type="button" className="btn sm" onClick={toggle}>{playing ? "Pause" : "Play"}</button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={position}
          onChange={onScrub}
          aria-label="Seek"
          style={{ flex: 1 }}
        />
        <span className="cell-sub">{fmt(position)} / {fmt(duration)}</span>
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Branch the detail page on `format`**

In `src/app/(app)/admin/recordings/[id]/page.tsx`:
- add `import { GuacRecordingPlayer } from "./guac-recording-player";`
- replace `<RecordingPlayer id={rec.id} />` with a format branch:

```tsx
        {rec.format === "GUAC"
          ? <GuacRecordingPlayer recordingId={rec.id} />
          : <RecordingPlayer id={rec.id} />}
```

- [ ] **Step 3: Add a format/protocol badge to the list**

In `src/app/(app)/admin/recordings/recordings-table.tsx`, render a small badge per row. Locate where each row's site/host cell is rendered and add, using the row's `format` and `protocol` fields (ensure the query feeding this table selects `format` and `protocol` — if the page component that loads rows uses `select`, add `format: true, protocol: true`; if it passes whole records, they're already present):

```tsx
<span className="pill">{r.format === "GUAC" ? (r.protocol ? r.protocol.toUpperCase() : "RDP") : "WEB"}</span>
```

(If `recordings-table.tsx` has a typed `Row`/props interface, add `format: string` and `protocol: string | null` to it. Verify the recordings **page** that builds the rows includes these fields; if it maps explicit fields, add `format` and `protocol` to that mapping.)

- [ ] **Step 4: Verify the build**

Run: `pnpm build`
Expected: PASS. (Type errors here usually mean the row type or the row-loading `select` is missing `format`/`protocol` — add them.)

- [ ] **Step 5: Add minimal player styling**

In the global stylesheet (`src/app/globals.css` — confirm the path; it is the token-based global CSS), add:

```css
.guac-recording-display { overflow: auto; max-width: 100%; background: #000; border-radius: 8px; }
.guac-recording-controls { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
```

- [ ] **Step 6: Verify the build again**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx" "src/app/(app)/admin/recordings/[id]/page.tsx" "src/app/(app)/admin/recordings/recordings-table.tsx" src/app/globals.css
git commit -m "feat(recording): replay native guac recordings + protocol badge in list"
```

---

### Task 9: Consent interstitial + audit event + Gate A

**Files:**
- Create: `src/app/gateway/[siteId]/session/consent-gate.tsx`
- Create: `src/app/api/gateway/[siteId]/consent/route.ts`
- Modify: `src/app/gateway/[siteId]/session/page.tsx`

**Interfaces:**
- Consumes: `resolvedRecordingConsentRequired()` (`@/lib/settings/platform`); `Site.recordSessions`; `appendAuditEvents` (`@/lib/audit/append`, shape `{ userId, siteId, host, method, path, status, decision, reason }`); `requireUser()` (existing).
- Produces: a client `<ConsentGate siteId onAccept>` interstitial wrapping `<GatewaySession>`; `POST /api/gateway/:siteId/consent` writes the acknowledgement audit event.

- [ ] **Step 1: Add the consent audit endpoint**

Create `src/app/api/gateway/[siteId]/consent/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { appendAuditEvents } from "@/lib/audit/append";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true } });
  if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    await appendAuditEvents([
      {
        userId: user.id,
        siteId,
        host: "manager",
        method: "POST",
        path: `/gateway/${siteId}/session`,
        status: 200,
        decision: "ALLOW",
        reason: "Vendor acknowledged that this session is recorded",
      },
    ]);
  } catch (err) {
    console.error("[gateway/consent] audit append failed:", err);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Add the consent interstitial client component**

Create `src/app/gateway/[siteId]/session/consent-gate.tsx`:

```tsx
"use client";
import { useState } from "react";
import { GatewaySession } from "./session-client";

export function ConsentGate({ siteId }: { siteId: string }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await fetch(`/api/gateway/${siteId}/consent`, { method: "POST" });
    } catch {
      /* audit is best-effort; proceed regardless */
    }
    setAccepted(true);
  }

  if (accepted) return <GatewaySession siteId={siteId} />;

  return (
    <div className="consent-gate">
      <div className="consent-card">
        <h1>This session is recorded</h1>
        <p>
          For security and compliance, your activity in this remote session is
          recorded. Continue only if you consent to being recorded.
        </p>
        <button type="button" className="btn primary" disabled={busy} onClick={accept}>
          {busy ? "Starting…" : "I understand — connect"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Branch the session page on consent**

In `src/app/gateway/[siteId]/session/page.tsx`:
- add imports:
  ```tsx
  import { resolvedRecordingConsentRequired } from "@/lib/settings/platform";
  import { ConsentGate } from "./consent-gate";
  ```
- add `recordSessions: true` to the site `select`
- after the existing `notFound()` guard, choose the gate:

```tsx
  const consentNeeded = site.recordSessions && (await resolvedRecordingConsentRequired());
  return consentNeeded ? <ConsentGate siteId={siteId} /> : <GatewaySession siteId={siteId} />;
```

The updated `select` and return (keep the rest of the guard unchanged):

```tsx
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { accessMode: true, recordSessions: true },
  });
  if (!nativeGatewayEnabled() || !site || site.accessMode !== "GATEWAY") {
    notFound();
  }
  const consentNeeded = site.recordSessions && (await resolvedRecordingConsentRequired());
  return consentNeeded ? <ConsentGate siteId={siteId} /> : <GatewaySession siteId={siteId} />;
```

- [ ] **Step 4: Add interstitial styling**

In `src/app/globals.css` add:

```css
.consent-gate { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
.consent-card { max-width: 420px; text-align: center; display: flex; flex-direction: column; gap: 16px; }
```

- [ ] **Step 5: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/gateway/[siteId]/session/consent-gate.tsx" "src/app/api/gateway/[siteId]/consent/route.ts" "src/app/gateway/[siteId]/session/page.tsx" src/app/globals.css
git commit -m "feat(gateway): recording-consent interstitial + acknowledgement audit event"
```

- [ ] **Step 7: Gate A — live validation (operator, after deploy)**

This is a manual acceptance gate, run after the slice is deployed (schema needs `access-migrate`; data-plane + manager rebuilt). Confirm:

1. `RECORDING_ENABLED=1`; a GATEWAY site with **Record sessions** on. Open it from `/access`, run a short RDP session, disconnect. In `/admin/recordings` a new row appears with an `RDP` badge. Open it → the guac player replays the session with a working seek bar and a sensible duration.
2. With `recordingConsentRequired` ON, opening the site shows the consent interstitial first; accepting connects and writes an audit event (visible in `/admin/audit`). With it OFF, the site connects directly.
3. Turn **Record sessions** off (or `RECORDING_ENABLED` off) → a new session creates no recording row.

---

## Self-Review

**1. Spec coverage:**
- Data model (enum + format/protocol/encrypted) → Task 2. ✓
- At-rest encryption (`encryptBytes`/`decryptBytes`) → Task 1. ✓
- Descriptor `record` flag + Go consume → Task 5. ✓
- Data-plane tee (`recWriter`, flush cadence, size cap, key gen, failure isolation) → Task 6. ✓
- `ingest-guac` → Task 4. ✓
- `assembleGuac` + serve route → Tasks 3, 7. ✓
- Replay UI (format branch, guac player, badge) → Task 8. ✓
- Consent gate + audit event → Task 9. ✓
- Retention/deletion/RBAC → reused unchanged (no task needed; verified they cover GUAC rows because they key off the same tables/guards). ✓
- Capability gating (RECORDING_ENABLED + recordSessions; RECORDING_MAX_BYTES) → Tasks 5, 6. ✓
- Testing (unit crypto/assemble; Go recWriter; Gate A) → Tasks 1, 3, 6, 9. ✓
- Deploy notes (bump manager+migrate+dataplane, run migrate) → captured in Global Constraints + Gate A preamble. ✓

**2. Placeholder scan:** No TBD/TODO; every code step carries real code. The one deliberately deferred verification (route unit tests) is justified against the existing repo pattern, not left vague.

**3. Type consistency:**
- `serializeGuacChunk(raw: Buffer): Buffer` / `assembleGuac(chunks, encrypted): Buffer` — defined Task 3, consumed identically in Tasks 4 (`serializeGuacChunk`) and 7 (`assembleGuac`). ✓
- `encryptBytes`/`decryptBytes(Buffer): Buffer` — Task 1, consumed Task 3. ✓
- `GatewayDescriptor(...) (GuacConn, string, string, bool, error)` — Task 5 defines the 5-return signature; Task 6 consumes `record` and the exported `ctrl.BaseURL`/`ctrl.Secret`. ✓
- `newRecWriter(managerURL, secret, key, siteID, userID, host, protocol string, capBytes int)` — Task 6 definition matches its `serveGuacTunnel` call and the test. ✓
- `SessionRecording.format` compared as the string `"GUAC"` in Tasks 4, 7, 8 — consistent with the Prisma enum value. ✓
- `appendAuditEvents` input shape used in Task 9 matches the existing call in `admin/recordings/[id]/route.ts`. ✓
