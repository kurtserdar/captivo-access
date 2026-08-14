# Seekable Isolated Recordings (hybrid) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ISOLATED (KasmVNC) recordings seekable in the admin player, keeping today's crash-safe live streaming as a fallback.

**Architecture:** The broker records with one ffmpeg `tee` writing both the live pipe (crash-safe interim chunks, as today) and a seekable file; on clean session end the file is finalized (SIGINT) and pulled to the manager, replacing the interim chunks. The serving route gains HTTP Range support.

**Tech Stack:** Python broker, Go data-plane, Next.js/TypeScript manager, ffmpeg. No schema change.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not break live watching (`/kasm-view`), terminate, the vendor session, or GATEWAY recording.
- Crash safety: a session that dies mid-way must still leave its interim (live) chunks — the finalize replace only happens after the live relay has fully drained.
- No schema change (chunk replacement is enough). Existing recordings stay non-seekable.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Spike — validate the ffmpeg `tee` command

**Files:** none (throwaway container run).

Validate that one ffmpeg can write a live pipe AND a seekable file, and that SIGINT finalizes the file. Uses `lavfi testsrc` to avoid needing an X display.

- [ ] **Step 1: tee to pipe + file, timed**

Run:
```bash
docker run --rm --entrypoint sh ghcr.io/kurtserdar/captivo-access-kasm-browser:0.69.0 -c '
ffmpeg -loglevel error -f lavfi -i testsrc=size=320x240:rate=10 -t 5 \
  -an -c:v libvpx -b:v 500k -deadline realtime \
  -f tee -map 0:v "[f=webm:onfail=ignore]pipe:1|[f=webm]/tmp/t.webm" > /tmp/pipe.webm;
echo "--- file probe ---"; ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 /tmp/t.webm;
echo "--- has Cues ---"; ffprobe -v error -show_entries format=tags -of json /tmp/t.webm >/dev/null && echo probe-ok'
```
Expected: `/tmp/t.webm` reports a real numeric duration (~5.0), pipe output also produced. If `tee` errors, use the fallback in Step 2.

- [ ] **Step 2: SIGINT-finalize + fallback check**

Run (start unbounded, SIGINT after 3 s, confirm the file is finalized):
```bash
docker run --rm --entrypoint sh ghcr.io/kurtserdar/captivo-access-kasm-browser:0.69.0 -c '
ffmpeg -loglevel error -f lavfi -i testsrc=size=320x240:rate=10 \
  -an -c:v libvpx -b:v 500k -deadline realtime \
  -f tee -map 0:v "[f=webm:onfail=ignore]pipe:1|[f=webm]/tmp/t.webm" > /tmp/pipe.webm & P=$!;
sleep 3; kill -INT $P; wait $P 2>/dev/null;
ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 /tmp/t.webm'
```
Expected: a real numeric duration (finalized). If `tee` misbehaves, the known-good fallback is two outputs from one input — record this as the command Task 4 uses instead:
```
ffmpeg … -an -c:v libvpx -b:v 1M -deadline realtime -f webm pipe:1 -f webm /rec/<sid>.webm
```

- [ ] **Step 3: Record the validated command**

Note in the commit message which command form (tee or two-output) Task 4 will use. No code commit for this task.

---

### Task 2: Manager — `finalize-video` endpoint

**Files:**
- Create: `src/app/api/internal/recording/finalize-video/route.ts`

**Interfaces:**
- Produces: `POST /api/internal/recording/finalize-video` accepting `{ recordingKey, seq, data }`; on `seq === 0` it deletes the recording's interim chunks, then appends the finalized (seekable) chunks. Skips silently if the recording doesn't exist.

- [ ] **Step 1: Write the endpoint**

Create `src/app/api/internal/recording/finalize-video/route.ts`:

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

interface FinalizeBody {
  recordingKey?: string;
  seq?: number;
  data?: string; // base64 seekable WebM bytes
}

// Replaces an isolated recording's interim (live) chunks with the finalized,
// seekable file streamed at clean session end. On the first chunk (seq 0) the old
// chunks are dropped; later chunks append. The live relay has already drained before
// this is called, so no interim chunk can race in.
export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return NextResponse.json({ error: "not found" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as FinalizeBody;
    const recordingKey = body.recordingKey;
    if (!recordingKey || !body.data) return new NextResponse(null, { status: 204 });
    const raw = Buffer.from(body.data, "base64");
    if (raw.length === 0) return new NextResponse(null, { status: 204 });
    const seq = typeof body.seq === "number" ? body.seq : 0;

    await db.$transaction(async (tx) => {
      const rec = await tx.sessionRecording.findUnique({ where: { recordingKey } });
      if (!rec) return; // no interim recording to finalize — nothing to do
      if (seq === 0) {
        await tx.recordingChunk.deleteMany({ where: { recordingId: rec.id } });
        await tx.sessionRecording.update({
          where: { id: rec.id },
          data: { bytes: raw.length, eventCount: 1, lastEventAt: new Date() },
        });
      } else {
        await tx.sessionRecording.update({
          where: { id: rec.id },
          data: { bytes: { increment: raw.length }, eventCount: { increment: 1 }, lastEventAt: new Date() },
        });
      }
      await tx.recordingChunk.create({ data: { recordingId: rec.id, seq, data: new Uint8Array(raw) } });
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[recording/finalize-video] failed to store finalized chunk:", err);
    return new NextResponse(null, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/internal/recording/finalize-video/route.ts"
git commit -m "feat(recording): finalize-video endpoint replacing interim chunks with the seekable file"
```

---

### Task 3: Manager — HTTP Range on the video serving route

**Files:**
- Modify: `src/app/api/admin/recordings/[id]/video/route.ts`

- [ ] **Step 1: Add Range handling**

In `src/app/api/admin/recordings/[id]/video/route.ts`, rename the request param `_req` → `req` and replace the final `return new NextResponse(...)` block with Range-aware serving:

```ts
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const total = blob.length;

  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" } });
    }
    const slice = blob.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        "Content-Type": "video/webm",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(slice.length),
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(new Uint8Array(blob), {
    status: 200,
    headers: {
      "Content-Type": "video/webm",
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/recordings/[id]/video/route.ts"
git commit -m "feat(recording): HTTP Range support on the video serving route"
```

---

### Task 4: Broker — tee capture + finalize + `/recording`

**Files:**
- Modify: `kasm-browser/control.py`

**Interfaces:**
- Produces: `/rec` streams the live pipe while also writing `/rec/<sid>.webm`; on disconnect ffmpeg is SIGINT-finalized (file kept). `GET /session/<sid>/recording` streams the finalized file. `close` removes it.

- [ ] **Step 1: Ensure the recording dir exists**

In `kasm-browser/control.py`, in the `__main__` block (next to `os.makedirs("/profiles", exist_ok=True)`), add:

```python
    os.makedirs("/rec", exist_ok=True)
```

- [ ] **Step 2: tee capture writing pipe + file**

Replace `_ffmpeg_capture(display)` with a version that also writes a seekable file (use the command form validated in Task 1 — this plan assumes `tee` passed; if the fallback was needed, use the two-output form there instead):

```python
def _ffmpeg_capture(display, recfile):
    # Grab the per-session Xvnc display as WebM (VP8). tee writes two sinks: the live
    # pipe (stdout, streamed to the data-plane — crash-safe interim recording) and a
    # seekable file (finalized on clean stop). onfail=ignore keeps the file writing
    # even if the pipe reader goes away.
    return subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-f", "x11grab",
         "-video_size", "1280x800", "-framerate", "10", "-i", ":%d" % display,
         "-an", "-c:v", "libvpx", "-b:v", "1M", "-deadline", "realtime",
         "-f", "tee", "-map", "0:v",
         "[f=webm:onfail=ignore]pipe:1|[f=webm]" + recfile],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
```

- [ ] **Step 3: `/rec` — store proc + file, SIGINT-finalize on disconnect**

In the `do_GET` `/rec` handler, build the file path, store the proc + file on the session, and SIGINT (not terminate) on disconnect so the file finalizes. Replace the handler body from `proc = _ffmpeg_capture(display)` through its `finally`:

```python
            recfile = "/rec/" + sid + ".webm"
            proc = _ffmpeg_capture(display, recfile)
            with _lock:
                s = _sessions.get(sid)
                if s is not None:
                    s["rec_proc"] = proc
                    s["rec_file"] = recfile
            self.send_response(200)
            self.send_header("Content-Type", "video/webm")
            self.end_headers()
            try:
                while True:
                    buf = proc.stdout.read1(65536)
                    if not buf:
                        break
                    self.wfile.write(buf)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                # SIGINT (not terminate/kill) so ffmpeg writes the trailer + Cues +
                # Duration, leaving /rec/<sid>.webm seekable for the finalize pull.
                if proc.poll() is None:
                    proc.send_signal(signal.SIGINT)
                    try:
                        proc.wait(timeout=8)
                    except Exception:
                        proc.kill()
            return
```

- [ ] **Step 4: New `GET /session/<sid>/recording`**

In `do_GET`, before the `/healthz` check, add a handler that streams the finalized file (finalizing first if ffmpeg somehow still runs):

```python
        if u.path.startswith("/session/") and u.path.endswith("/recording"):
            sid = u.path[len("/session/"):-len("/recording")]
            with _lock:
                s = _sessions.get(sid)
                recfile = s.get("rec_file") if s else None
                proc = s.get("rec_proc") if s else None
            if proc is not None and proc.poll() is None:
                proc.send_signal(signal.SIGINT)
                try:
                    proc.wait(timeout=8)
                except Exception:
                    proc.kill()
            if not recfile or not os.path.exists(recfile):
                return self._json(404, {"error": "not_found"})
            try:
                size = os.path.getsize(recfile)
                self.send_response(200)
                self.send_header("Content-Type", "video/webm")
                self.send_header("Content-Length", str(size))
                self.end_headers()
                with open(recfile, "rb") as f:
                    while True:
                        buf = f.read(65536)
                        if not buf:
                            break
                        self.wfile.write(buf)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return
```

- [ ] **Step 5: `close` removes the recording file**

In `_kill(sess)`, after removing the profile/home dirs, remove the recording file:

```python
    rf = sess.get("rec_file")
    if rf:
        try:
            os.remove(rf)
        except OSError:
            pass
```

- [ ] **Step 6: Verify Python parses**

Run: `python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add kasm-browser/control.py
git commit -m "feat(isolated): tee recording to a seekable file + /recording finalize endpoint"
```

---

### Task 5: Data-plane — pull the finalized file on clean close

**Files:**
- Modify: `dataplane/kasmrecord.go` (finalize POST helper)
- Modify: `dataplane/kasmtunnel.go` (teardown: drain live relay → finalize-pull → broker close)

**Interfaces:**
- Consumes: broker `GET /session/<id>/recording`, manager `finalize-video`.
- Produces: `postFinalizeVideo(managerURL, secret, key, data []byte, seq int)` in kasmrecord.go.

- [ ] **Step 1: finalize POST helper**

In `dataplane/kasmrecord.go`, add a helper that POSTs one finalized chunk to the manager (reuses the same shape as `flush`):

```go
// postFinalizeVideo sends one chunk of the finalized (seekable) recording to the
// manager's finalize-video endpoint, which replaces the interim chunks. Best-effort.
func postFinalizeVideo(managerURL, secret, key string, seq int, data []byte) {
	payload, err := json.Marshal(map[string]any{
		"recordingKey": key,
		"seq":          seq,
		"data":         base64.StdEncoding.EncodeToString(data),
	})
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, managerURL+"/api/internal/recording/finalize-video", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", secret)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("kasm-recording key=%s: finalize post failed err=%v", key, err)
		return
	}
	resp.Body.Close()
}
```

- [ ] **Step 2: Restructure the recording teardown in kasmtunnel.go**

In `dataplane/kasmtunnel.go`, inside the WebSocket block, the recording currently sets up a live-relay goroutine with `defer recConn.Close()` and a separate broker-close `defer`. Replace that structure so the live relay signals when it has fully drained, and a single teardown defer finalizes before closing.

Change the recording setup (the `if d.Record { if recConn, e := ...` block) to capture a done channel and a cleanup closure instead of `defer recConn.Close()`:

```go
		var recCleanup func()
		if d.Record {
			if recConn, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
				rw := newKasmRecWriter(ctrl.BaseURL, ctrl.Secret,
					newRecordingKey(siteID, userID), siteID, userID, d.NavigateUrl, recordingMaxBytes())
				_, _ = io.WriteString(recConn, "GET /session/"+id+"/rec HTTP/1.0\r\nHost: "+d.KasmControlAddr+"\r\nConnection: close\r\n\r\n")
				recDone := make(chan struct{})
				go func() {
					defer close(recDone)
					defer recConn.Close()
					resp, re := http.ReadResponse(bufio.NewReader(recConn), nil)
					if re != nil {
						return
					}
					defer resp.Body.Close()
					buf := make([]byte, 65536)
					for {
						n, er := resp.Body.Read(buf)
						if n > 0 {
							rw.Write(buf[:n])
						}
						if er != nil {
							break
						}
					}
					rw.Close()
				}()
				recCleanup = func() {
					// Stop the live relay → broker SIGINTs ffmpeg → /rec/<id>.webm is
					// finalized; wait for the interim chunks to fully drain, then pull
					// the seekable file and replace them. Best-effort throughout.
					recConn.Close()
					<-recDone
					if fc, fe := dialGuacd(sess, d.KasmControlAddr); fe == nil {
						_, _ = io.WriteString(fc, "GET /session/"+id+"/recording HTTP/1.0\r\nHost: "+d.KasmControlAddr+"\r\nConnection: close\r\n\r\n")
						if fresp, fre := http.ReadResponse(bufio.NewReader(fc), nil); fre == nil && fresp.StatusCode == 200 {
							seq := 0
							buf := make([]byte, 262144)
							for {
								n, er := fresp.Body.Read(buf)
								if n > 0 {
									postFinalizeVideo(ctrl.BaseURL, ctrl.Secret, rw.key, seq, buf[:n])
									seq++
								}
								if er != nil {
									break
								}
							}
							fresp.Body.Close()
						}
						fc.Close()
					}
				}
				log.Printf("kasm-tunnel site=%s: recording enabled key=%s", siteID, rw.key)
			} else {
				log.Printf("kasm-tunnel site=%s: recording dial failed err=%v", siteID, e)
			}
		}
```

Then replace the existing broker-close `defer func() { ... buildKasmCloseRequest ... }()` with a teardown defer that finalizes first:

```go
		defer func() {
			// Finalize the seekable recording (drain live relay + pull file) BEFORE
			// tearing the session down, so the file still exists on the broker.
			if recCleanup != nil {
				recCleanup()
			}
			if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
				_, _ = st.Write([]byte(buildKasmCloseRequest(d.KasmControlAddr, id)))
				_ = st.Close()
			}
			log.Printf("kasm-tunnel site=%s: hi-fi session %s closed", siteID, id)
		}()
```

Remove the old recording block's `defer recConn.Close()` (now handled inside `recCleanup`) and the old standalone recording goroutine/defer that this replaces. The `hub.RegisterIsolated` + `defer hub.Remove(sessionID)` (Slice 1) stay as-is, after this block.

- [ ] **Step 3: Build + test**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dataplane/kasmrecord.go dataplane/kasmtunnel.go
git commit -m "feat(dataplane): pull finalized seekable recording on clean isolated session end"
```

---

### Task 6: Full verification

**Files:** none.

- [ ] **Step 1: All builds green**

Run: `pnpm build && cd dataplane && go build ./... && go test ./... && cd .. && python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('py ok')"`
Expected: all PASS.

- [ ] **Step 2: Wiring grep**

Run: `grep -rn "finalize-video" src/app/api dataplane/kasmrecord.go && grep -rn "/recording" kasm-browser/control.py dataplane/kasmtunnel.go`
Expected: finalize-video referenced in the endpoint + kasmrecord; `/recording` in the broker + dataplane.

- [ ] **Step 3: Manual Gate (record for deploy gate)**

Deferred to deploy:
- Record an isolated session, end it cleanly, open the recording → the duration is correct and scrubbing to any second works (seekable). Range requests return 206 (Network tab).
- Kill a session mid-way (close the tab / terminate) → a partial recording still exists and plays (interim chunks, non-seekable).
- GATEWAY recordings + live watching unchanged.

---

## Self-Review

**Spec coverage:**
- Broker tee (pipe + file), SIGINT-finalize, `/recording`, close-rm → Task 4 (validated by Task 1 spike). ✓
- Live interim chunks unchanged (crash safety) + drain-before-finalize → Task 5 Step 2 (`<-recDone`). ✓
- finalize-video replaces interim chunks on seq 0 → Task 2. ✓
- HTTP Range on serving route → Task 3. ✓
- Pull finalized file on clean close → Task 5. ✓
- No schema change; existing recordings stay non-seekable → per design. ✓

**Placeholder scan:** none — every code step is concrete; Task 1 is an explicit spike with commands + fallback.

**Type/name consistency:** `postFinalizeVideo(managerURL, secret, key string, seq int, data []byte)` defined in Task 5 Step 1, called in Step 2. `rw.key` is the exported-within-package field already used by `newKasmRecWriter`. Broker session keys `rec_proc`/`rec_file` set in Task 4 Step 3 and read in Steps 4–5. `finalize-video` path identical in Task 2 (route) and Task 5 (`postFinalizeVideo`). Range route keeps the same `video/webm` content type as before.
