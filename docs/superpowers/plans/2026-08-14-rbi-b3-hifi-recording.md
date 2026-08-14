# RBI Transport B (KasmVNC) Hi-Fi Session Recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline execution — subagent quota is full). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a high-fidelity (KasmVNC) isolated-browser session as WebM video and play it back in `/admin/recordings`, honoring the site's `recordSessions` toggle.

**Architecture:** The broker runs `ffmpeg x11grab` on the per-session Xvnc display and serves its live WebM output at `GET /session/<id>/rec`. The data-plane, on a recorded session, streams that through the connector relay to the manager's `ingest-video` endpoint (the video analog of transport A's `recWriter`). Storage reuses `SessionRecording`/`RecordingChunk` with a new `VIDEO` format; playback adds a `<video>` player.

**Tech Stack:** ffmpeg (x11grab → libvpx/WebM), Go (data-plane stream relay), Python 3 stdlib (broker), Next.js (ingest + playback route + player), Prisma (RecordingFormat enum).

## Global Constraints

- English only — console, commits, comments, release notes.
- No Claude signature in commits or PRs.
- Transport B must not import/depend on `dataplane/isolated.go` (transport A, deleted after B3). `kasmrecord.go` is self-contained; it may reuse the format-neutral helpers `newRecordingKey` / `recordingMaxBytes` from `guacrecord.go`.
- Video chunks are stored unencrypted this slice (`encrypted: false`); at-rest video encryption is a follow-up.
- Recording is best-effort: a capture/POST failure logs and never blocks or breaks the live session.
- `recFlushBytes = 256 KiB`, `recFlushInterval = 2 s`, `recordingMaxBytes()` default 500 MiB (reused from `guacrecord.go`).
- Deploy is a SEPARATE gate requiring explicit user approval — do NOT auto-run. Target tag v0.64.0 (manager + migrate + dataplane + kasm image; schema change → `access-migrate`).

---

### Task 1: Schema — add the VIDEO recording format

**Files:**
- Modify: `prisma/schema.prisma` (`enum RecordingFormat`)

**Interfaces:**
- Produces: `RecordingFormat.VIDEO` usable by the ingest route (Task 2) and the player (Task 7).

- [ ] **Step 1: Add VIDEO to the enum**

```prisma
enum RecordingFormat {
  RRWEB
  GUAC
  VIDEO
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `cd /opt/captivo-access && pnpm db:generate 2>&1 | tail -3`
Expected: client generates without error (`src/generated/prisma`).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(rbi): add VIDEO recording format for hi-fi isolated sessions"
```

(The DB `db push` happens at deploy via `access-migrate`; local generate is enough to typecheck.)

---

### Task 2: Manager — ingest-video endpoint

Store raw WebM chunks posted by the data-plane. Mirror `ingest-guac` but for opaque
video bytes (no guac serialization, unencrypted).

**Files:**
- Create: `src/app/api/internal/recording/ingest-video/route.ts`

**Interfaces:**
- Consumes: `RecordingFormat.VIDEO` (Task 1).
- Produces: `POST /api/internal/recording/ingest-video` accepting `{recordingKey, seq, siteId, userId, host, data(base64 webm)}`, DATAPLANE_SECRET-gated; consumed by `kasmRecWriter` (Task 5).

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

interface IngestVideoBody {
  recordingKey?: string;
  seq?: number;
  siteId?: string;
  userId?: string;
  host?: string;
  data?: string; // base64 raw WebM bytes
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return NextResponse.json({ error: "not found" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as IngestVideoBody;
    const recordingKey = body.recordingKey;
    if (!recordingKey || !body.data) return new NextResponse(null, { status: 204 });

    const raw = Buffer.from(body.data, "base64");
    if (raw.length === 0) return new NextResponse(null, { status: 204 });
    const seq = typeof body.seq === "number" ? body.seq : 0;

    await db.$transaction(async (tx) => {
      const rec = await tx.sessionRecording.upsert({
        where: { recordingKey },
        create: {
          recordingKey,
          userId: body.userId ?? "",
          siteId: body.siteId ?? "",
          host: body.host ?? "",
          format: "VIDEO",
          encrypted: false,
          protocol: "kasm",
          eventCount: 1,
          bytes: raw.length,
          lastEventAt: new Date(),
        },
        update: {
          eventCount: { increment: 1 },
          bytes: { increment: raw.length },
          lastEventAt: new Date(),
        },
      });
      await tx.recordingChunk.create({
        data: { recordingId: rec.id, seq, data: new Uint8Array(raw) },
      });
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Best-effort: recording must never throw back to the data-plane.
    console.error("[recording/ingest-video] failed to store chunk:", err);
    return new NextResponse(null, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/captivo-access && pnpm build > /tmp/b3-t2.log 2>&1; echo "exit=$?"; tail -3 /tmp/b3-t2.log`
Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/internal/recording/ingest-video/route.ts
git commit -m "feat(rbi): ingest-video endpoint for hi-fi session recordings"
```

---

### Task 3: Manager — descriptor records hi-fi sessions

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts` (kasm branch)

**Interfaces:**
- Consumes: `recordingEnabled()` (already imported), `site.recordSessions` (already in the `select`).
- Produces: the kasm descriptor returns `record: true|false` (consumed by `kasmDesc.Record`, Task 6).

- [ ] **Step 1: Wire record into the kasm branch**

Replace the hardcoded `record: false, // hi-fi recording = B3` line with:

```ts
        record: recordingEnabled() && site.recordSessions,
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/captivo-access && pnpm build > /tmp/b3-t3.log 2>&1; echo "exit=$?"; tail -3 /tmp/b3-t3.log`
Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/internal/gateway/descriptor/route.ts
git commit -m "feat(rbi): enable recording in the hi-fi isolated descriptor"
```

---

### Task 4: kasm image — ffmpeg + broker `/rec` endpoint

Add ffmpeg and stream the per-session display as live WebM. No Python test framework;
validated by the broker spike in Task 8.

**Files:**
- Modify: `kasm-browser/Dockerfile`
- Modify: `kasm-browser/control.py`

**Interfaces:**
- Produces: `GET /session/<id>/rec` → chunked `video/webm` live stream of the session's display; ffmpeg terminates on client disconnect / unknown id → 404. Broker stays recordingKey-agnostic.

- [ ] **Step 1: Add ffmpeg to the image**

In `kasm-browser/Dockerfile`, add `ffmpeg` to the apt-get install package list (the line installing `chromium fluxbox python3 dumb-init …`).

- [ ] **Step 2: Add the `/rec` handler + ffmpeg spawn to `control.py`**

Add a helper that starts ffmpeg on a display and a `do_GET` route. Ffmpeg is spawned
per `/rec` request (recording lifecycle = connection lifecycle):

```python
import subprocess  # already imported

def _ffmpeg_capture(display):
    # Grab the per-session Xvnc display as live WebM (VP8), no audio, ~10 fps.
    # Output goes to stdout so the /rec handler can stream it to the data-plane.
    return subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-f", "x11grab",
         "-video_size", "1280x800", "-framerate", "10", "-i", ":%d" % display,
         "-an", "-c:v", "libvpx", "-b:v", "1M", "-deadline", "realtime",
         "-f", "webm", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
```

In `class H`'s `do_GET`, before the `/healthz` branch, add the `/rec` route:

```python
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith("/session/") and u.path.endswith("/rec"):
            sid = u.path[len("/session/"):-len("/rec")]
            with _lock:
                sess = _sessions.get(sid)
                display = sess["display"] if sess else None
            if display is None:
                return self._json(404, {"error": "not_found"})
            proc = _ffmpeg_capture(display)
            self.send_response(200)
            self.send_header("Content-Type", "video/webm")
            self.end_headers()
            try:
                while True:
                    buf = proc.stdout.read(65536)
                    if not buf:
                        break
                    self.wfile.write(buf)  # raises when the data-plane disconnects
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except Exception:
                    proc.kill()
            return
        if u.path == "/healthz":
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not_found"})
```

(Keep the existing `/healthz` behavior; only the `/rec` branch is new. The handler
runs on the existing `ThreadingHTTPServer`, so a long-lived `/rec` request occupies
one thread per recorded session.)

- [ ] **Step 3: Build the image**

Run: `cd /opt/captivo-access && docker build -f kasm-browser/Dockerfile -t captivo-access-kasm-browser:dbg .`
Expected: build succeeds (ffmpeg installed).

- [ ] **Step 4: Smoke — /rec streams WebM, ffmpeg dies on disconnect**

```bash
docker rm -f kasm-rec 2>/dev/null
docker run -d --name kasm-rec --shm-size=1g captivo-access-kasm-browser:dbg >/dev/null
sleep 6
ID=$(docker exec kasm-rec python3 -c "import urllib.request;r=urllib.request.Request('http://127.0.0.1:7900/session',data=b'{\"url\":\"https://example.com\"}',headers={'Content-Type':'application/json'});import json;print(json.load(urllib.request.urlopen(r))['id'])")
# read ~2s of the /rec stream, save, and check the WebM magic bytes (1A 45 DF A3)
docker exec kasm-rec python3 -c "
import urllib.request
r=urllib.request.urlopen('http://127.0.0.1:7900/session/$ID/rec', timeout=5)
data=r.read(200000)
open('/tmp/cap.webm','wb').write(data)
print('bytes', len(data), 'magic', data[:4].hex())
"
echo "--- ffmpeg count while streaming ended (expect it terminated after read closed) ---"
sleep 2; docker exec kasm-rec sh -c 'ps -e | grep -c ffmpeg'
docker rm -f kasm-rec >/dev/null
```

Expected: `bytes` > 0 and `magic 1a45dfa3` (WebM/Matroska EBML header); ffmpeg count returns to 0 after the read closed (spawned-per-request and terminated on disconnect).

- [ ] **Step 5: Commit**

```bash
git add kasm-browser/Dockerfile kasm-browser/control.py
git commit -m "feat(rbi): broker streams the isolated session as live WebM via ffmpeg"
```

---

### Task 5: Data-plane — kasmRecWriter (video chunk forwarder)

**Files:**
- Create: `dataplane/kasmrecord.go`
- Test: `dataplane/kasmrecord_test.go`

**Interfaces:**
- Consumes: `newRecordingKey`, `recordingMaxBytes`, `recFlushBytes`, `recFlushInterval` (from `guacrecord.go`).
- Produces:
  - `newKasmRecWriter(managerURL, secret, key, siteID, userID, host string, capBytes int) *kasmRecWriter`
  - `(*kasmRecWriter).Write(b []byte)` — buffer + flush to `/api/internal/recording/ingest-video`.
  - `(*kasmRecWriter).Close()` — flush the tail.

- [ ] **Step 1: Write the failing test**

Create `dataplane/kasmrecord_test.go`:

```go
package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestKasmRecWriterFlushesToIngestVideo(t *testing.T) {
	var gotPath, gotSecret, gotData string
	var gotSeq int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSecret = r.Header.Get("x-dataplane-secret")
		b, _ := io.ReadAll(r.Body)
		var m struct {
			Data string `json:"data"`
			Seq  int    `json:"seq"`
		}
		_ = json.Unmarshal(b, &m)
		gotData, gotSeq = m.Data, m.Seq
		w.WriteHeader(204)
	}))
	defer srv.Close()

	w := newKasmRecWriter(srv.URL, "sekret", "k1", "site1", "user1", "host1", 1<<20)
	// A payload >= recFlushBytes forces an immediate flush.
	w.Write([]byte(strings.Repeat("A", recFlushBytes+16)))
	w.Close()

	if gotPath != "/api/internal/recording/ingest-video" {
		t.Fatalf("path=%q", gotPath)
	}
	if gotSecret != "sekret" {
		t.Fatalf("secret=%q", gotSecret)
	}
	if gotSeq != 0 {
		t.Fatalf("seq=%d want 0", gotSeq)
	}
	dec, _ := base64.StdEncoding.DecodeString(gotData)
	if len(dec) < recFlushBytes {
		t.Fatalf("decoded %d bytes, want >= %d", len(dec), recFlushBytes)
	}
}

func TestKasmRecWriterStopsAtCap(t *testing.T) {
	var posts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		posts++
		w.WriteHeader(204)
	}))
	defer srv.Close()
	w := newKasmRecWriter(srv.URL, "s", "k", "si", "u", "h", 10) // 10-byte cap
	w.Write([]byte(strings.Repeat("A", recFlushBytes))) // over cap on the first write
	w.Write([]byte(strings.Repeat("B", recFlushBytes))) // dropped (stopped)
	w.Close()
	if posts > 1 {
		t.Fatalf("posts=%d, expected capture to stop after the cap", posts)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/captivo-access/dataplane && go test ./... 2>&1 | head -8`
Expected: compile failure — `newKasmRecWriter` undefined.

- [ ] **Step 3: Implement `kasmrecord.go`**

```go
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// kasmRecWriter tees a KasmVNC session's live WebM byte stream to the manager's
// ingest-video endpoint in recFlushBytes / recFlushInterval chunks. It is the video
// analog of guacrecord.go's recWriter and is deliberately self-contained (transport
// B must not depend on transport A's isolated.go). Best-effort: a failed POST or a
// reached cap never blocks the session. Single-goroutine (the recording relay loop).
type kasmRecWriter struct {
	managerURL string
	secret     string
	key        string
	siteID     string
	userID     string
	host       string
	capBytes   int

	buf       bytes.Buffer
	seq       int
	total     int
	lastFlush time.Time
	stopped   bool
	client    *http.Client
}

func newKasmRecWriter(managerURL, secret, key, siteID, userID, host string, capBytes int) *kasmRecWriter {
	return &kasmRecWriter{
		managerURL: managerURL, secret: secret, key: key,
		siteID: siteID, userID: userID, host: host, capBytes: capBytes,
		lastFlush: time.Now(), client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Write appends WebM bytes and flushes when the buffer reaches recFlushBytes or
// recFlushInterval has elapsed. Once the cumulative total exceeds capBytes, capture
// stops (logged once) and further writes are dropped.
func (w *kasmRecWriter) Write(b []byte) {
	if w.stopped {
		return
	}
	if w.total >= w.capBytes {
		log.Printf("kasm-recording site=%s key=%s: size cap reached, stopping capture", w.siteID, w.key)
		w.stopped = true
		return
	}
	w.buf.Write(b)
	w.total += len(b)
	if w.buf.Len() >= recFlushBytes || time.Since(w.lastFlush) >= recFlushInterval {
		w.flush()
	}
}

func (w *kasmRecWriter) flush() {
	if w.buf.Len() == 0 {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"recordingKey": w.key,
		"seq":          w.seq,
		"siteId":       w.siteID,
		"userId":       w.userID,
		"host":         w.host,
		"data":         base64.StdEncoding.EncodeToString(w.buf.Bytes()),
	})
	w.seq++
	w.buf.Reset()
	w.lastFlush = time.Now()
	if err != nil {
		log.Printf("kasm-recording key=%s: marshal failed err=%v", w.key, err)
		return
	}
	req, err := http.NewRequest(http.MethodPost, w.managerURL+"/api/internal/recording/ingest-video", bytes.NewReader(payload))
	if err != nil {
		log.Printf("kasm-recording key=%s: build request failed err=%v", w.key, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", w.secret)
	resp, err := w.client.Do(req)
	if err != nil {
		log.Printf("kasm-recording key=%s seq=%d: ingest post failed err=%v", w.key, w.seq-1, err)
		return
	}
	resp.Body.Close()
}

// Close flushes the tail chunk.
func (w *kasmRecWriter) Close() { w.flush() }
```

Update the test to call `w.Write([]byte(strings.Repeat(...)))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dataplane/kasmrecord.go dataplane/kasmrecord_test.go
git commit -m "feat(rbi): kasmRecWriter forwards hi-fi session WebM to ingest-video"
```

---

### Task 6: Data-plane — wire recording into serveKasmTunnel

**Files:**
- Modify: `dataplane/kasmtunnel.go`

**Interfaces:**
- Consumes: `newKasmRecWriter` (Task 5), `newRecordingKey`, `recordingMaxBytes` (guacrecord.go), `dialGuacd`, `kasmDesc`.

- [ ] **Step 1: Add Record to kasmDesc**

In the `kasmDesc` struct, add:

```go
	Record          bool   `json:"record"`
```

- [ ] **Step 2: Spawn the recording relay in the WS branch**

In `serveKasmTunnel`, inside the `if strings.EqualFold(r.Header.Get("Upgrade"), "websocket")` block, AFTER the session is opened and `backendAddr` is set (right before the reverse-proxy is built), add a recording relay tied to the WS lifetime:

```go
		if d.Record {
			// Live-stream the session video to the manager (video analog of A's
			// recWriter). The relay reads the broker's ffmpeg WebM output through the
			// connector and forwards chunks; closing recConn stops ffmpeg + flushes.
			recConn, e := dialGuacd(sess, d.KasmControlAddr)
			if e == nil {
				rw := newKasmRecWriter(ctrl.BaseURL, ctrl.Secret,
					newRecordingKey(siteID, userID), siteID, userID, d.NavigateUrl, recordingMaxBytes())
				req := "GET /session/" + id + "/rec HTTP/1.0\r\nHost: " + d.KasmControlAddr + "\r\nConnection: close\r\n\r\n"
				_, _ = io.WriteString(recConn, req)
				go func() {
					defer recConn.Close()
					br := bufio.NewReader(recConn)
					// Skip the HTTP response headers; the body is the raw WebM stream.
					if _, e := http.ReadResponse(br, nil); e != nil {
						return
					}
					buf := make([]byte, 65536)
					for {
						n, er := br.Read(buf)
						if n > 0 {
							rw.Write(buf[:n])
						}
						if er != nil {
							break
						}
					}
					rw.Close()
				}()
				defer recConn.Close() // WS end -> close relay -> ffmpeg stops
				log.Printf("kasm-tunnel site=%s: recording enabled key=%s", siteID, rw.key)
			} else {
				log.Printf("kasm-tunnel site=%s: recording dial failed err=%v", siteID, e)
			}
		}
```

Note: `http.ReadResponse` with an `http.Client{}`-less nil request works for reading
the status line + headers off the stream; the remaining `br` bytes are the WebM body.
`rw.key` — expose the `key` field is already lowercase/unexported but same-package, so
`rw.key` is accessible. Ensure `bufio`, `io`, `net/http`, `log` are imported (most
already are).

- [ ] **Step 3: Build + test + independence check**

Run:
```
cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -5
grep -n 'isolated\.go\|openBrowserSession\|isoGuard' kasmtunnel.go kasmrecord.go || echo "clean (no transport-A dependency)"
```
Expected: build + tests PASS; `clean`.

- [ ] **Step 4: Commit**

```bash
git add dataplane/kasmtunnel.go
git commit -m "feat(rbi): stream hi-fi isolated session recording through the connector"
```

---

### Task 7: Manager — video playback route + player

**Files:**
- Create: `src/app/api/admin/recordings/[id]/video/route.ts`
- Create: `src/app/(app)/admin/recordings/[id]/video-recording-player.tsx`
- Modify: `src/app/(app)/admin/recordings/[id]/page.tsx`

**Interfaces:**
- Consumes: `SessionRecording(format=VIDEO)` + `RecordingChunk` (Tasks 1–2).
- Produces: `GET /api/admin/recordings/[id]/video` streaming the assembled `video/webm`; `VideoRecordingPlayer` rendering it.

- [ ] **Step 1: Write the video serving route** (mirror the `guac` route, no decryption)

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({ where: { id } });
  if (!rec || rec.format !== "VIDEO") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const chunks = await db.recordingChunk.findMany({
    where: { recordingId: id },
    orderBy: { seq: "asc" },
    select: { data: true },
  });
  const blob = Buffer.concat(chunks.map((c) => Buffer.from(c.data)));

  return new NextResponse(new Uint8Array(blob), {
    status: 200,
    headers: {
      "Content-Type": "video/webm",
      "Content-Length": String(blob.length),
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Write the player component**

```tsx
"use client";

// Streams the assembled WebM straight from the serving route — no client-side
// blob assembly needed; the browser plays the video/webm response directly.
export function VideoRecordingPlayer({ id }: { id: string }) {
  return (
    <video
      controls
      src={`/api/admin/recordings/${id}/video`}
      style={{ width: "100%", maxHeight: "70vh", background: "#000" }}
    />
  );
}
```

- [ ] **Step 3: Select the player by format in `page.tsx`**

Add the import and extend the ternary:

```tsx
import { VideoRecordingPlayer } from "./video-recording-player";
```

```tsx
        {rec.format === "GUAC"
          ? <GuacRecordingPlayer recordingId={rec.id} />
          : rec.format === "VIDEO"
          ? <VideoRecordingPlayer id={rec.id} />
          : <RecordingPlayer id={rec.id} />}
```

- [ ] **Step 4: Typecheck**

Run: `cd /opt/captivo-access && pnpm build > /tmp/b3-t7.log 2>&1; echo "exit=$?"; tail -3 /tmp/b3-t7.log`
Expected: `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/recordings/[id]/video/route.ts" "src/app/(app)/admin/recordings/[id]/video-recording-player.tsx" "src/app/(app)/admin/recordings/[id]/page.tsx"
git commit -m "feat(rbi): play back hi-fi VIDEO recordings in /admin/recordings"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Manager build + Go build/test**

Run:
```
cd /opt/captivo-access && pnpm build > /tmp/b3-v.log 2>&1; echo "mgr=$?"; tail -2 /tmp/b3-v.log
cd /opt/captivo-access/dataplane && go build ./... && go test ./... 2>&1 | tail -3
```
Expected: mgr exit 0; Go PASS.

- [ ] **Step 2: Build the kasm image**

Run: `cd /opt/captivo-access && docker build -f kasm-browser/Dockerfile -t captivo-access-kasm-browser:dbg .`
Expected: succeeds.

- [ ] **Step 3: Full local recording spike (capture → assemble → playable WebM)**

```bash
docker rm -f kasm-full 2>/dev/null
docker run -d --name kasm-full --shm-size=1g captivo-access-kasm-browser:dbg >/dev/null
sleep 6
ID=$(docker exec kasm-full python3 -c "import urllib.request,json;r=urllib.request.Request('http://127.0.0.1:7900/session',data=b'{\"url\":\"https://example.com\"}',headers={'Content-Type':'application/json'});print(json.load(urllib.request.urlopen(r))['id'])")
sleep 2
# capture ~4s of video and validate it decodes (ffprobe is in the image now)
docker exec kasm-full sh -c "timeout 4 curl -s http://127.0.0.1:7900/session/$ID/rec -o /tmp/full.webm; ffprobe -v error -show_entries stream=codec_name,width,height -of default=noprint_wrappers=1 /tmp/full.webm; echo size=\$(wc -c </tmp/full.webm)"
docker rm -f kasm-full >/dev/null
```

Expected: ffprobe reports `codec_name=vp8`, `width=1280`, `height=800`; `size` > 0. (If `curl` is absent, reuse the Python read from Task 4 Step 4.)

- [ ] **Step 4: Concurrency regression (recording doesn't break MAX_SESSIONS)**

```bash
docker rm -f kasm-cr 2>/dev/null
docker run -d --name kasm-cr --shm-size=1g -e MAX_SESSIONS=3 captivo-access-kasm-browser:dbg >/dev/null
sleep 6
OPEN='import urllib.request;r=urllib.request.Request("http://127.0.0.1:7900/session",data=b"{\"url\":\"https://example.com\"}",headers={"Content-Type":"application/json"});print(urllib.request.urlopen(r).read().decode())'
docker exec kasm-cr python3 -c "$OPEN"; docker exec kasm-cr python3 -c "$OPEN"; docker exec kasm-cr python3 -c "$OPEN"
echo "Xvnc count (expect 4=hub+3):"; docker exec kasm-cr sh -c 'ps -e | grep -c Xvnc'
docker rm -f kasm-cr >/dev/null
```

Expected: three sessions, Xvnc count 4.

- [ ] **Step 5: Commit any spike-driven fix (only if needed)**

```bash
git add -A && git commit -m "fix(rbi): <describe spike fix>"
```

---

## Deployment (SEPARATE GATE — explicit user approval required, do NOT auto-run)

Target **v0.64.0** — schema change, so manager + migrate move together.

1. `git push origin main` + `git tag v0.64.0 && git push origin v0.64.0`; watch `publish.yml` green.
2. In `/opt/captivo-access-prod/docker-compose.yml`, bump `access-manager`, `access-migrate`, and `access-dataplane` to `0.64.0`; `docker compose pull access-manager access-migrate access-dataplane`.
3. Apply the schema: `docker compose run --rm access-migrate` (adds the VIDEO enum value).
4. `docker compose up -d access-manager access-dataplane`.
5. On the gateway host, **Update the connector** to pull the new `captivo-kasm:latest` (ffmpeg + `/rec`).
6. Verify: `/login` 200; `docker exec cap-access-manager sh -c 'echo $APP_VERSION'` → 0.64.0. (`RECORDING_ENABLED` must be set on the manager for recording to activate.)
7. `gh release edit v0.64.0 --notes "<English, user-focused>"`. No Claude signature.

**Gate-A (operator):** open a recorded (recordSessions=on) hi-fi ISOLATED session, interact, close; `/admin/recordings` lists it as a VIDEO recording; playback shows the real session video.

**After Gate-A passes:** delete transport A (separate slice) — captivo-browser image, `isolated.go`, `isolationHiFi` toggle, descriptor VNC-isolated branch, form streaming-quality select → ISOLATED always KasmVNC.

---

## Self-Review

**Spec coverage:** VIDEO format (Task 1) ✓; ffmpeg x11grab WebM + broker `/rec` lifecycle (Task 4) ✓; data-plane kasmRecWriter live relay tied to WS lifetime + best-effort + cap (Tasks 5–6) ✓; ingest-video storage format=VIDEO/encrypted=false (Task 2) ✓; descriptor record wiring (Task 3) ✓; VIDEO playback route + `<video>` player + format selection (Task 7) ✓; broker recordingKey-agnostic / data-plane owns the key (Task 6 uses `newRecordingKey`) ✓; transport-B independence from isolated.go (Task 6 grep check) ✓; verification incl. valid-WebM + concurrency regression (Task 8) ✓; deploy manager+migrate+dataplane+kasm, migrate run, connector Update, English note (Deployment) ✓.

**Placeholder scan:** none — all code concrete; the one conditional (Task 8 Step 5) is a real branch.

**Type consistency:** `newKasmRecWriter(managerURL, secret, key, siteID, userID, host string, capBytes int)` used identically in the test, the impl, and the `serveKasmTunnel` call; `(*kasmRecWriter).Write([]byte)` / `.Close()` match; ingest-video JSON keys `{recordingKey, seq, siteId, userId, host, data}` match between `flush()` and the route's `IngestVideoBody`; `kasmDesc.Record` (json `record`) matches the descriptor's `record` field; broker `GET /session/<id>/rec` path matches the data-plane request string; player route `/api/admin/recordings/[id]/video` matches the `<video src>`; `RecordingFormat` values `RRWEB|GUAC|VIDEO` consistent across schema, ingest (`format:"VIDEO"`), serving route (`rec.format !== "VIDEO"`), and page selection.
