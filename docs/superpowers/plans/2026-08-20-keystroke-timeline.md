# Session Keystroke Timeline (SSH + RDP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a searchable, timestamped keystroke timeline for SSH+RDP gateway sessions (opt-in per Resource), stored encrypted, linked to the recording so clicking an entry seeks the player to that moment.

**Architecture:** A `keyObserver` taps the browser→guacd input pump (mirroring `ftObserver`), reconstructs SSH command lines / RDP text bursts with a recording-relative `atMs`, and posts them to a manager ingest endpoint that encrypts + stores `SessionKeyEvent` rows. The recording page adds a timeline panel that seeks the guac player.

**Tech Stack:** Go (data-plane), Next.js/TypeScript + Prisma (manager), guacamole-common-js player, vitest + `go test`.

## Global Constraints

- **Language:** English only — comments, identifiers, UI strings, commits (public repo).
- **No Claude signature** in commits.
- **Opt-in + requires recording.** Keystroke logging is OFF by default per Resource, and only active when `recordSessions` is also on (the timeline seeks into the recording). Descriptor returns `keystrokeLogging = recordingEnabled() && site.recordSessions && site.keystrokeLogging`.
- **Encrypted at rest.** `SessionKeyEvent.data` = `encryptBytes(text)` (AES-256-GCM), same as recordings. Never store plaintext keystrokes.
- **Same recording key.** The keyObserver + recWriter share ONE `recordingKey` so `SessionKeyEvent.recordingKey == SessionRecording.recordingKey`.
- **X11 keysyms:** printable 0x20–0x7E == char; Enter `0xFF0D`, Backspace `0xFF08`, Tab `0xFF09`.
- **Password masking is best-effort** (a deterrent); the per-Resource opt-in is the real control. Mask stores `••••` + `masked=true`, never the secret.
- **Deploy + release notes are SEPARATE gates.** Central stack (data-plane + manager); no connector/kasm change. `prisma db push` for the schema. Call out opt-in + "captures typed input incl. possible secrets" in the note.

---

## File Structure

- Create: `dataplane/keyevents.go` — `keyObserver` + `keyEvent`.
- Create: `dataplane/keyevents_test.go`.
- Create: `dataplane/keywriter.go` — posts events to the manager ingest.
- Modify: `dataplane/guactunnel.go` — share the recording key; construct + wire the keyObserver on the input pump; flush at end.
- Modify: `dataplane/controlclient.go` — `GatewayDescriptor` returns `keystrokeLogging`.
- Modify: `prisma/schema.prisma` — `SessionKeyEvent` model + `Site.keystrokeLogging`.
- Modify: `src/lib/site/validate.ts`, `src/app/(app)/admin/sites/site-form.tsx`, `src/app/(app)/admin/sites/[id]/edit/page.tsx`, `src/app/api/admin/sites/route.ts` + `[id]/route.ts` — the opt-in toggle (GATEWAY).
- Modify: `src/app/api/internal/gateway/descriptor/route.ts` — return `keystrokeLogging`.
- Create: `src/app/api/internal/recording/keyevents/route.ts` — ingest (encrypt).
- Create: `src/app/api/admin/recordings/[id]/keyevents/route.ts` — read (decrypt).
- Modify: `src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx` — timeline panel + seek.

---

### Task 1: keyObserver reconstruction (data-plane, pure)

**Files:**
- Create: `dataplane/keyevents.go`, `dataplane/keyevents_test.go`

**Interfaces:**
- Produces: `type keyEvent struct { AtMs int64; Kind, Text string; Masked bool }`;
  `newKeyObserver(protocol string, start time.Time) *keyObserver`;
  `(o *keyObserver) observe(raw []byte, now time.Time) []keyEvent`;
  `(o *keyObserver) flush(now time.Time) []keyEvent`.

- [ ] **Step 1: Write the failing test**

Create `dataplane/keyevents_test.go`:
```go
package main

import (
	"testing"
	"time"
)

func inst(op string, args ...string) []byte {
	return encodeInstruction(op, args...) // existing helper
}
func keydown(keysym int) []byte { return inst("key", itoa(keysym), "1") }

func TestKeyObserverSSHLine(t *testing.T) {
	base := time.Unix(1000, 0)
	o := newKeyObserver("ssh", base)
	for _, c := range "ls -la" {
		o.observe(keydown(int(c)), base)
	}
	evs := o.observe(keydown(0xFF0D), base.Add(2*time.Second)) // Enter
	if len(evs) != 1 || evs[0].Kind != "command" || evs[0].Text != "ls -la" || evs[0].AtMs != 2000 {
		t.Fatalf("unexpected: %+v", evs)
	}
}

func TestKeyObserverBackspace(t *testing.T) {
	base := time.Unix(1000, 0)
	o := newKeyObserver("ssh", base)
	for _, c := range "lss" {
		o.observe(keydown(int(c)), base)
	}
	o.observe(keydown(0xFF08), base) // backspace
	evs := o.observe(keydown(0xFF0D), base)
	if len(evs) != 1 || evs[0].Text != "ls" {
		t.Fatalf("backspace: %+v", evs)
	}
}

func TestKeyObserverPasswordMask(t *testing.T) {
	base := time.Unix(1000, 0)
	o := newKeyObserver("ssh", base)
	for _, c := range "sudo su" {
		o.observe(keydown(int(c)), base)
	}
	o.observe(keydown(0xFF0D), base) // "sudo su" -> arms masking
	for _, c := range "hunter2" {
		o.observe(keydown(int(c)), base)
	}
	evs := o.observe(keydown(0xFF0D), base)
	if len(evs) != 1 || !evs[0].Masked || evs[0].Text != "••••" {
		t.Fatalf("mask: %+v", evs)
	}
}

func TestKeyObserverRDPBurstOnIdle(t *testing.T) {
	base := time.Unix(1000, 0)
	o := newKeyObserver("rdp", base)
	o.observe(keydown(int('a')), base)
	o.observe(keydown(int('b')), base.Add(100*time.Millisecond))
	// a >1.5s gap flushes the previous burst on the next key
	evs := o.observe(keydown(int('c')), base.Add(2*time.Second))
	if len(evs) != 1 || evs[0].Kind != "text" || evs[0].Text != "ab" {
		t.Fatalf("burst: %+v", evs)
	}
}
```
(If `itoa`/`encodeInstruction` names differ, use the existing helpers — `encodeInstruction` is used in guactunnel.go; add a tiny `itoa` in the test if needed.)

- [ ] **Step 2: Run it (fail)**

Run: `cd /opt/captivo-access/dataplane && go test ./... -run TestKeyObserver`
Expected: FAIL (undefined: newKeyObserver).

- [ ] **Step 3: Implement `keyevents.go`**

Create `dataplane/keyevents.go`:
```go
package main

import (
	"bufio"
	"bytes"
	"strconv"
	"strings"
	"time"
)

type keyEvent struct {
	AtMs   int64  `json:"atMs"`
	Kind   string `json:"kind"` // "command" (ssh) | "text" (rdp)
	Text   string `json:"text"`
	Masked bool   `json:"masked"`
}

const (
	ksEnter     = 0xff0d
	ksBackspace = 0xff08
	ksTab       = 0xff09
)

// keyObserver reconstructs typed input from the guac `key` instructions on the
// browser->guacd pump. SSH emits one event per line (Enter); RDP emits a "text"
// burst on Enter or after an idle gap. atMs is relative to the recording start.
type keyObserver struct {
	ssh      bool
	start    time.Time
	line     strings.Builder
	lastKey  time.Time
	maskNext bool
}

func newKeyObserver(protocol string, start time.Time) *keyObserver {
	return &keyObserver{ssh: strings.EqualFold(protocol, "ssh"), start: start}
}

func (o *keyObserver) observe(raw []byte, now time.Time) []keyEvent {
	var out []keyEvent
	br := bufio.NewReader(bytes.NewReader(raw))
	for {
		op, args, err := parseInstruction(br)
		if err != nil {
			break
		}
		if op != "key" || len(args) < 2 || args[1] != "1" { // key-down only
			continue
		}
		keysym, _ := strconv.Atoi(args[0])
		if !o.ssh && !o.lastKey.IsZero() && now.Sub(o.lastKey) > 1500*time.Millisecond && o.line.Len() > 0 {
			out = append(out, o.emit(now))
		}
		o.lastKey = now
		switch keysym {
		case ksEnter:
			if o.line.Len() > 0 {
				out = append(out, o.emit(now))
			}
		case ksBackspace:
			s := o.line.String()
			o.line.Reset()
			if len(s) > 0 {
				o.line.WriteString(s[:len(s)-1])
			}
		default:
			if keysym >= 0x20 && keysym <= 0x7e {
				o.line.WriteByte(byte(keysym))
			}
		}
	}
	return out
}

func (o *keyObserver) flush(now time.Time) []keyEvent {
	if o.line.Len() == 0 {
		return nil
	}
	return []keyEvent{o.emit(now)}
}

func (o *keyObserver) emit(now time.Time) keyEvent {
	text := o.line.String()
	o.line.Reset()
	masked := o.maskNext
	if masked {
		text = "••••"
	}
	o.maskNext = passwordPrompt(text)
	kind := "text"
	if o.ssh {
		kind = "command"
	}
	return keyEvent{AtMs: now.Sub(o.start).Milliseconds(), Kind: kind, Text: text, Masked: masked}
}

func passwordPrompt(s string) bool {
	l := strings.ToLower(strings.TrimSpace(s))
	return strings.HasPrefix(l, "sudo") || strings.HasPrefix(l, "su ") || l == "su" || strings.Contains(l, "passwd")
}
```

- [ ] **Step 4: Run tests (pass) + commit**

Run: `cd /opt/captivo-access/dataplane && go test ./... -run TestKeyObserver`
Expected: PASS.
```bash
cd /opt/captivo-access
git add dataplane/keyevents.go dataplane/keyevents_test.go
git commit -m "feat(sessions): keyObserver — reconstruct SSH commands / RDP text bursts from guac key events"
```

---

### Task 2: Schema + per-Resource opt-in + descriptor

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/site/validate.ts`, `src/app/(app)/admin/sites/site-form.tsx`, `src/app/(app)/admin/sites/[id]/edit/page.tsx`, `src/app/api/admin/sites/route.ts`, `src/app/api/admin/sites/[id]/route.ts`, `src/app/api/internal/gateway/descriptor/route.ts`, `dataplane/controlclient.go`

**Interfaces:**
- Produces: `Site.keystrokeLogging Boolean @default(false)`; `SessionKeyEvent` model; the descriptor returns `keystrokeLogging`; the data-plane's `GatewayDescriptor` returns it.

- [ ] **Step 1: Schema**

In `prisma/schema.prisma`, add to `Site` (near `recordSessions`):
```prisma
  keystrokeLogging   Boolean       @default(false) // GATEWAY: capture typed input into a keystroke timeline
```
And a new model:
```prisma
model SessionKeyEvent {
  id           String   @id @default(cuid())
  recordingKey String   // ties to SessionRecording.recordingKey
  seq          Int
  atMs         Int      // offset from recording start, ms (player seek)
  kind         String   // "command" | "text"
  data         Bytes    // AES-256-GCM(text)
  masked       Boolean  @default(false)
  createdAt    DateTime @default(now())

  @@index([recordingKey, seq])
}
```
Run: `cd /opt/captivo-access && PW=$(grep '^POSTGRES_PASSWORD=' /opt/captivo-access-prod/.env | cut -d= -f2-) DATABASE_URL="postgresql://access:${PW}@127.0.0.1:5434/captivo_access" npx prisma db push && npx prisma generate`
Expected: in sync.

- [ ] **Step 2: Validation (GATEWAY branch)**

In `src/lib/site/validate.ts`, add `keystrokeLogging: boolean` to the GATEWAY `SiteValidation` variant, and in the GATEWAY branch return add:
```ts
      keystrokeLogging: opts.recordingEnabled && body.recordSessions === true && body.keystrokeLogging === true,
```

- [ ] **Step 3: Site form + persistence + edit select**

In `site-form.tsx`: add `keystrokeLogging?: boolean` to the site type; a `useState`; the submit payload (`keystrokeLogging,`); and a checkbox in the GATEWAY block (near the record toggle) — "Keystroke timeline — capture typed input (incl. possible secrets); requires recording."
In `[id]/edit/page.tsx`: add `keystrokeLogging: true` to the select + `keystrokeLogging: site.keystrokeLogging` to the passed `site`.
In `api/admin/sites/route.ts` + `[id]/route.ts`: add `keystrokeLogging: v.keystrokeLogging` to the GATEWAY create/update `data` (validate only sets it true for GATEWAY; harmless elsewhere).

- [ ] **Step 4: Descriptor returns it**

In `src/app/api/internal/gateway/descriptor/route.ts`, add `keystrokeLogging: true` to the `site.findUnique` select, and in the GATEWAY return add:
```ts
    keystrokeLogging: recordingEnabled() && site.recordSessions && site.keystrokeLogging,
```

- [ ] **Step 5: Data-plane descriptor field**

In `dataplane/controlclient.go`, find `GatewayDescriptor` and the struct it decodes the descriptor JSON into; add a `KeystrokeLogging bool \`json:"keystrokeLogging"\`` field and return it (extend the function's return signature to include `keystrokeLogging bool`). Update the one caller in `guactunnel.go` (Task 3 uses it).

- [ ] **Step 6: Build**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tail -3` (BUILD_OK) and `cd dataplane && go build ./...`.

- [ ] **Step 7: Commit**

```bash
cd /opt/captivo-access
git add prisma/schema.prisma src/lib/site/validate.ts "src/app/(app)/admin/sites" src/app/api/admin/sites src/app/api/internal/gateway/descriptor/route.ts dataplane/controlclient.go
git commit -m "feat(sessions): per-Resource keystroke-logging opt-in + SessionKeyEvent schema + descriptor threading"
```

---

### Task 3: Ingest endpoint + poster + tunnel wiring

**Files:**
- Create: `src/app/api/internal/recording/keyevents/route.ts`, `dataplane/keywriter.go`
- Modify: `dataplane/guactunnel.go`

**Interfaces:**
- Consumes: `keyObserver` (Task 1), `GatewayDescriptor().keystrokeLogging` (Task 2).
- Produces: events posted to `/api/internal/recording/keyevents` and stored encrypted.

- [ ] **Step 1: Manager ingest endpoint**

Create `src/app/api/internal/recording/keyevents/route.ts` (mirror `ingest-guac`; secret-guarded):
```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptBytes } from "@/lib/crypto";
import { recordingEnabled } from "@/lib/recording/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return new NextResponse(null, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { recordingKey?: string; events?: { atMs: number; kind: string; text: string; masked: boolean }[] };
  const key = body.recordingKey;
  const events = Array.isArray(body.events) ? body.events : [];
  if (!key || events.length === 0) return new NextResponse(null, { status: 204 });
  const base = await db.sessionKeyEvent.count({ where: { recordingKey: key } });
  await db.sessionKeyEvent.createMany({
    data: events.map((e, i) => ({
      recordingKey: key,
      seq: base + i,
      atMs: Math.max(0, Math.round(e.atMs)),
      kind: e.kind === "command" ? "command" : "text",
      data: new Uint8Array(encryptBytes(Buffer.from(e.text, "utf8"))),
      masked: !!e.masked,
    })),
  });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: Data-plane poster**

Create `dataplane/keywriter.go` (best-effort, like recWriter):
```go
package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type keyWriter struct {
	managerURL, secret, key string
	client                  *http.Client
}

func newKeyWriter(managerURL, secret, key string) *keyWriter {
	return &keyWriter{managerURL: managerURL, secret: secret, key: key, client: &http.Client{Timeout: 10 * time.Second}}
}

func (w *keyWriter) post(events []keyEvent) {
	if len(events) == 0 {
		return
	}
	body, _ := json.Marshal(map[string]any{"recordingKey": w.key, "events": events})
	req, err := http.NewRequest(http.MethodPost, w.managerURL+"/api/internal/recording/keyevents", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", w.secret)
	resp, err := w.client.Do(req)
	if err != nil {
		log.Printf("keyevents key=%s: post failed err=%v", w.key, err)
		return
	}
	resp.Body.Close()
}
```

- [ ] **Step 3: Wire into `guactunnel.go`**

1. Extend the `GatewayDescriptor` call to receive `keystrokeLogging` (Task 2 changed its signature).
2. Compute one shared recording key and build both writers when recording is on:
```go
	recKey := newRecordingKey(siteID, userID)
	var rec *recWriter
	if record {
		rec = newRecWriter(ctrl.BaseURL, ctrl.Secret, recKey, siteID, userID, conn.Hostname, conn.Protocol, recordingMaxBytes())
		defer rec.Close()
	}
	var keys *keyObserver
	var kw *keyWriter
	if record && keystrokeLogging {
		keys = newKeyObserver(conn.Protocol, time.Now())
		kw = newKeyWriter(ctrl.BaseURL, ctrl.Secret, recKey)
	}
```
(Replace the existing `rec = newRecWriter(..., newRecordingKey(...), ...)` so both share `recKey`.)
3. In the **browser→guacd** pump, after `ft.observe(dirUpload, data)`:
```go
			if keys != nil {
				if evs := keys.observe(data, time.Now()); len(evs) > 0 {
					kw.post(evs)
				}
			}
```
4. After the pumps end (near `ft.flush()`), flush any pending line:
```go
	if keys != nil {
		if evs := keys.flush(time.Now()); len(evs) > 0 {
			kw.post(evs)
		}
	}
```

- [ ] **Step 4: Build**

Run: `cd /opt/captivo-access/dataplane && go build ./... && go test ./...` ; `cd /opt/captivo-access && pnpm build 2>&1 | tail -2`.
Expected: green + BUILD_OK.

- [ ] **Step 5: Commit**

```bash
cd /opt/captivo-access
git add src/app/api/internal/recording/keyevents/route.ts dataplane/keywriter.go dataplane/guactunnel.go
git commit -m "feat(sessions): ingest keystroke events (encrypted) + wire the keyObserver into the gateway tunnel"
```

---

### Task 4: Read endpoint + timeline UI (seek)

**Files:**
- Create: `src/app/api/admin/recordings/[id]/keyevents/route.ts`
- Modify: `src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx`

**Interfaces:**
- Consumes: `SessionKeyEvent` rows; the guac player's `recording.seek(ms)`.
- Produces: `GET /api/admin/recordings/[id]/keyevents` → `[{ atMs, kind, text, masked }]`; a timeline panel that seeks the player.

- [ ] **Step 1: Read endpoint (decrypt)**

Create `src/app/api/admin/recordings/[id]/keyevents/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { decryptBytes } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "view_recordings")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({ where: { id }, select: { recordingKey: true } });
  if (!rec) return NextResponse.json([]);
  const rows = await db.sessionKeyEvent.findMany({ where: { recordingKey: rec.recordingKey }, orderBy: { seq: "asc" }, select: { atMs: true, kind: true, data: true, masked: true } });
  const events = rows.map((r) => ({
    atMs: r.atMs, kind: r.kind, masked: r.masked,
    text: r.masked ? "••••" : (() => { try { return decryptBytes(Buffer.from(r.data)).toString("utf8"); } catch { return ""; } })(),
  }));
  return NextResponse.json(events);
}
```
(Use whatever capability the recording pages already gate on — match `/events` or `/guac` route's `can(...)` check.)

- [ ] **Step 2: Timeline panel + seek in the player**

In `src/app/(app)/admin/recordings/[id]/guac-recording-player.tsx`: keep a ref to the `recording` object (it already exists as `recording`), store it so the panel can call `recording.seek(atMs, () => {})`. Add state + fetch:
```tsx
  const [events, setEvents] = useState<{ atMs: number; kind: string; text: string; masked: boolean }[]>([]);
  const [q, setQ] = useState("");
  const recRef = useRef<any>(null); // set recRef.current = recording where it is created

  useEffect(() => {
    fetch(`/api/admin/recordings/${recordingId}/keyevents`).then((r) => r.ok ? r.json() : []).then(setEvents).catch(() => {});
  }, [recordingId]);

  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  const shown = events.filter((e) => !q || e.text.toLowerCase().includes(q.toLowerCase()));
```
Render (beside/below the player), only when `events.length > 0`:
```tsx
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head"><div className="ch-title"><h2>Timeline</h2><span className="sub">Typed input — click to jump</span></div></div>
        <input className="input" placeholder="Search commands…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
        <div style={{ maxHeight: "18rem", overflowY: "auto" }}>
          {shown.map((e, i) => (
            <button key={i} type="button" className="scp-item" style={{ display: "flex", gap: 10, width: "100%", textAlign: "left" }}
              onClick={() => recRef.current?.seek?.(e.atMs, () => {})}>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "#94a3b8" }}>{fmt(e.atMs)}</span>
              <span style={{ fontFamily: "monospace" }}>{e.text}</span>
            </button>
          ))}
        </div>
      </div>
```
Set `recRef.current = recording;` right after the `SessionRecording` is constructed (line ~28). (If seeking before the recording finishes loading is unreliable, seek is still best-effort — guacamole-common-js buffers; "jump near the moment" is the goal.)

- [ ] **Step 3: Build**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tail -2` → BUILD_OK.

- [ ] **Step 4: Commit**

```bash
cd /opt/captivo-access
git add src/app/api/admin/recordings src/app/\(app\)/admin/recordings/\[id\]/guac-recording-player.tsx
git commit -m "feat(sessions): keystroke timeline panel on the recording page (search + click-to-seek)"
```

---

## Final verification (after all tasks)

- [ ] `cd /opt/captivo-access/dataplane && go build ./... && go test ./...` — green.
- [ ] `cd /opt/captivo-access && pnpm build` — Compiled successfully; `npx vitest run src/lib/site/validate.test.ts` green.
- [ ] **Manual (post-deploy):** a GATEWAY SSH Resource with recording + keystroke logging ON → type a few commands → the recording page shows a Timeline; clicking a row seeks the player; a `sudo`/password line shows `••••`; a Resource with keystroke logging OFF captures nothing; an RDP Resource shows text bursts.

## Release (SEPARATE GATES — do not auto-run)

Central stack (data-plane + manager); no connector/kasm change. `prisma db push` on deploy. On tag, add an English user-focused `gh release edit` note; call out that keystroke logging is **opt-in per Resource** and captures typed input **including possible secrets**.
