# Native HTML5 Gateway — Slice 1 (core tunnel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an RDP/SSH/VNC session inside a Captivo page via our own guacd tunnel — no Guacamole web app, credential injected server-side.

**Architecture:** The browser runs `guacamole-common-js` and opens a WebSocket to a new Go data-plane guac-tunnel. The tunnel authenticates the Captivo session, asks the manager for the connection descriptor (grant-checked, vault-decrypted), opens a raw relay to guacd through the connector (a `handleLdap`-style relay), performs the guacd handshake injecting the credential, and pipes the Guacamole protocol. Manager (TS) + data-plane/connector/tunnel (Go) + frontend bundle.

**Tech Stack:** Go (connector, data-plane, tunnel module), Next.js (manager API + session page), `guacamole-common-js` (browser), `guacd` 1.5.5.

## Global Constraints

- **English only** in code, comments, commits, UI, docs. **No Claude signature** in commits.
- **The credential lives only in the manager.** The data-plane fetches a per-session descriptor over the internal API (DATAPLANE_SECRET gated) and injects it into the guacd handshake; it never persists or logs the plaintext.
- **Guacamole protocol wire format:** each instruction is comma-separated `LENGTH.VALUE` elements terminated by `;`, LENGTH = character count of VALUE (e.g. `6.select,3.rdp;`).
- **Handshake model mirrors `guacamole-lite`:** `select <protocol>` → read guacd `args` → send `size`/`audio`/`video`/`image`/`timezone` → send `connect` with arg values in guacd's order (creds filled from the descriptor) → read `ready` → relay raw both ways.
- **Capability gate `NATIVE_GATEWAY`** (mirrors `vaultEnabled()`), off by default. On → GATEWAY sites route Open to the native session page; off → the existing json-auth launch (unchanged).
- **Reuse the connector relay pattern** (`handleLdap`/`LdapDialRequest`) and the data-plane control-client (`ResolveSession`) — do not invent new transport.
- **Go:** connector/data-plane/tunnel are separate modules under `go.work` with `replace ../tunnel`. Build each with `go build ./...`; test with `go test ./...` in the module dir.
- **Task 1 (spike) gates Tasks 3 and 5** — the guacd handshake sequence is confirmed against a real guacd before the tunnel is built on it.

---

## File Structure

- `tunnel/guacdframe.go` (new) — `GuacdDialRequest`/`GuacdDialResponse` frames.
- `connector/handler.go` — add `case "guacd"` + `handleGuacd` (clone of `handleLdap`).
- `dataplane/guacproto.go` (new) — Guacamole instruction encode/parse + handshake.
- `dataplane/guacproto_test.go` (new) — pure wire-format + handshake-builder tests.
- `dataplane/guactunnel.go` (new) — the WebSocket endpoint + relay orchestration.
- `dataplane/controlclient.go` — add `GatewayDescriptor(userID, siteID)`.
- `dataplane/main.go` — mount the guac-tunnel endpoint.
- `src/app/api/internal/gateway/descriptor/route.ts` (new) — descriptor API.
- `src/lib/gateway/native.ts` (new) — `nativeGatewayEnabled()` gate.
- `src/app/(app)/access/gateway/[siteId]/session/` (new) — the session page + bundled client.
- `src/app/(app)/access/access-view.tsx` — native-GATEWAY Open → session page.

---

### Task 1: De-risk spike — guacd handshake + client render

**Files:** none committed to the product (throwaway), except this plan's notes.

- [ ] **Step 1: Stand up guacd locally.** `docker run -d --name spike-guacd -p 127.0.0.1:4822:4822 guacamole/guacd:1.5.5`. Have a reachable RDP or SSH target (a local `linuxserver/openssh-server` container works for SSH).

- [ ] **Step 2: Prove the handshake with a raw script.** Connect a TCP socket to `127.0.0.1:4822` and send, reading between sends:
  `6.select,3.ssh;` → read `args` → send `4.size,4.1024,3.768,2.96;`, `5.audio;`, `5.video;`, `5.image;` → send `connect` with the arg values guacd listed (fill hostname/port/username/password). Expect guacd to reply `5.ready,<id>;` then drawing instructions. Confirm the exact `args` order and required params for ssh/rdp/vnc; record them for Task 3.

- [ ] **Step 3: Prove the browser render.** Minimal HTML page loading `guacamole-common-js` with a `Guacamole.Client` over a `Guacamole.WebSocketTunnel` to a tiny local Node/Go relay that does Step 2's handshake then pipes. Confirm the session draws. (The handshake half is verifiable headlessly by Step 2; the render half is a browser check.)

- [ ] **Step 4: Record the outcome** (args order per protocol, any gotchas, the exact handshake sequence) in the ledger/report. If guacd rejects the handshake or the client won't render, STOP and revisit with the user before Task 3/5.

- [ ] **Step 5: Tear down** `docker rm -f spike-guacd` and any target container. No commit.

---

### Task 2: Tunnel frame + connector guacd relay

**Files:**
- Create: `tunnel/guacdframe.go`
- Create: `tunnel/guacdframe_test.go`
- Modify: `connector/handler.go`

**Interfaces:**
- Produces: `tunnel.GuacdDialRequest{ Kind, Target string }`, `tunnel.GuacdDialResponse{ Error string }`; connector dispatch handles `Kind == "guacd"`.

- [ ] **Step 1: Write the failing frame test.** In `tunnel/guacdframe_test.go` (mirror `wsframe_test.go`):

```go
package tunnel

import ("bytes"; "testing")

func TestGuacdDialRequestRoundTrip(t *testing.T) {
	in := GuacdDialRequest{Kind: "guacd", Target: "guacd:4822"}
	var buf bytes.Buffer
	b, _ := marshal(in) // use json.Marshal in the real test
	_ = b
	if err := WriteFrame(&buf, mustJSON(in)); err != nil { t.Fatal(err) }
	out, err := ReadFrame(&buf)
	if err != nil { t.Fatal(err) }
	got := unmarshalGuacd(out)
	if got.Kind != "guacd" || got.Target != "guacd:4822" { t.Fatalf("got %+v", got) }
}
```
  (Use `encoding/json` directly as `wsframe_test.go` does; the helper names above are illustrative — match the existing test's exact style with `json.Marshal`/`json.Unmarshal`.)

- [ ] **Step 2: Run it to fail.** `cd tunnel && go test ./...` → FAIL (undefined type).

- [ ] **Step 3: Implement `tunnel/guacdframe.go`** (mirror `ldapframe.go`):

```go
package tunnel

// GuacdDialRequest is the first control frame on a guacd stream (Kind "guacd").
// Target is the guacd "host:port" the connector plain-TCP-dials; the Guacamole
// protocol then runs opaquely over the relay.
type GuacdDialRequest struct {
	Kind   string `json:"kind"`   // "guacd"
	Target string `json:"target"` // "host:port"
}

// GuacdDialResponse reports whether the connector reached guacd. Empty Error = ok.
type GuacdDialResponse struct {
	Error string `json:"error,omitempty"`
}
```

- [ ] **Step 4: Add the connector handler.** In `connector/handler.go`, add to the `switch peek.Kind` in `handleStream`: `case "guacd": handleGuacd(cst, allow, reqBytes)`. Add `handleGuacd` as an exact clone of `handleLdap` with the guacd types:

```go
func handleGuacd(st io.ReadWriteCloser, allow *TargetMatcher, reqBytes []byte) {
	var gr tunnel.GuacdDialRequest
	if json.Unmarshal(reqBytes, &gr) != nil {
		return
	}
	host, port, err := net.SplitHostPort(gr.Target)
	if err != nil || host == "" || port == "" {
		writeGuacdErr(st, "bad target")
		return
	}
	if !egressAllowed(allow, gr.Target) {
		denied()
		logDenied("guacd", gr.Target)
		writeGuacdErr(st, "target not allowed")
		return
	}
	upstream, err := net.DialTimeout("tcp", gr.Target, 10*time.Second)
	if err != nil {
		logUpstreamErr("guacd", gr.Target, err.Error())
		writeGuacdErr(st, "guacd unreachable")
		return
	}
	defer upstream.Close()
	if b, mErr := json.Marshal(tunnel.GuacdDialResponse{}); mErr == nil {
		if tunnel.WriteFrame(st, b) != nil {
			return
		}
	} else {
		return
	}
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(st, upstream); done <- struct{}{} }()
	go func() { _, _ = io.Copy(upstream, st); done <- struct{}{} }()
	<-done
}

func writeGuacdErr(st io.Writer, msg string) {
	if b, err := json.Marshal(tunnel.GuacdDialResponse{Error: msg}); err == nil {
		_ = tunnel.WriteFrame(st, b)
	}
}
```

- [ ] **Step 5: Run tests + build.** `cd tunnel && go test ./...` PASS; `cd connector && go build ./...` OK.

- [ ] **Step 6: Commit.**

```bash
cd /opt/captivo-access && git add tunnel/guacdframe.go tunnel/guacdframe_test.go connector/handler.go && git commit -m "feat(gateway): connector guacd raw relay + tunnel frame"
```

---

### Task 3: Guacamole protocol handshake (data-plane, pure) — **spike-informed**

**Files:**
- Create: `dataplane/guacproto.go`
- Create: `dataplane/guacproto_test.go`

**Interfaces:**
- Produces:
  - `encodeInstruction(elems ...string) []byte` → `LENGTH.VALUE,…;`.
  - `parseInstruction(r *bufio.Reader) (op string, args []string, err error)`.
  - `type GuacConn struct { Protocol, Hostname, Port, Username, Secret, SecretKind string; Width, Height, Dpi int }`.
  - `buildConnect(argNames []string, c GuacConn) []byte` — fills guacd's requested arg names from `c` (hostname/port/username/password or private-key), blank for unknown names.

- [ ] **Step 1: Write failing tests.** In `dataplane/guacproto_test.go`:

```go
package main

import ("bufio"; "bytes"; "testing")

func TestEncodeInstruction(t *testing.T) {
	got := string(encodeInstruction("select", "rdp"))
	if got != "6.select,3.rdp;" { t.Fatalf("got %q", got) }
}
func TestParseInstruction(t *testing.T) {
	r := bufio.NewReader(bytes.NewReader([]byte("4.args,8.hostname,4.port;")))
	op, args, err := parseInstruction(r)
	if err != nil || op != "args" || len(args) != 2 || args[0] != "hostname" || args[1] != "port" {
		t.Fatalf("op=%q args=%v err=%v", op, args, err)
	}
}
func TestBuildConnectFillsCreds(t *testing.T) {
	names := []string{"VERSION_1_5_0", "hostname", "port", "username", "password"}
	c := GuacConn{Hostname: "10.0.0.5", Port: "3389", Username: "adm", Secret: "pw", SecretKind: "PASSWORD"}
	out := string(buildConnect(names, c))
	// connect echoes a value per name in order; VERSION is blank, creds filled.
	if want := "7.connect,0.,8.10.0.0.5,4.3389,3.adm,2.pw;"; out != want {
		t.Fatalf("got %q want %q", out, want)
	}
}
```

- [ ] **Step 2: Run to fail.** `cd dataplane && go test ./... -run TestEncode` → FAIL.

- [ ] **Step 3: Implement `dataplane/guacproto.go`.** Use the spike's confirmed arg handling.

```go
package main

import ("bufio"; "fmt"; "strconv"; "strings")

// encodeInstruction builds a Guacamole instruction: LENGTH.VALUE,…; where LENGTH
// is the rune count of VALUE.
func encodeInstruction(elems ...string) []byte {
	var b strings.Builder
	for i, e := range elems {
		if i > 0 { b.WriteByte(',') }
		fmt.Fprintf(&b, "%d.%s", len([]rune(e)), e)
	}
	b.WriteByte(';')
	return []byte(b.String())
}

// parseInstruction reads one instruction: the first element is the opcode, the
// rest are args.
func parseInstruction(r *bufio.Reader) (string, []string, error) {
	var elems []string
	for {
		lenStr, err := r.ReadString('.')
		if err != nil { return "", nil, err }
		n, err := strconv.Atoi(strings.TrimSuffix(lenStr, "."))
		if err != nil || n < 0 { return "", nil, fmt.Errorf("bad length %q", lenStr) }
		val := make([]rune, n)
		for i := 0; i < n; i++ {
			ch, _, err := r.ReadRune()
			if err != nil { return "", nil, err }
			val[i] = ch
		}
		sep, _, err := r.ReadRune()
		if err != nil { return "", nil, err }
		elems = append(elems, string(val))
		if sep == ';' { break }
		if sep != ',' { return "", nil, fmt.Errorf("bad separator %q", sep) }
	}
	if len(elems) == 0 { return "", nil, fmt.Errorf("empty instruction") }
	return elems[0], elems[1:], nil
}

type GuacConn struct {
	Protocol, Hostname, Port, Username, Secret, SecretKind string
	Width, Height, Dpi int
}

// buildConnect echoes one value per arg name guacd listed, filling connection
// params from c. Names it doesn't recognise get an empty value (guacd default).
func buildConnect(argNames []string, c GuacConn) []byte {
	elems := []string{"connect"}
	for _, name := range argNames {
		switch name {
		case "hostname": elems = append(elems, c.Hostname)
		case "port": elems = append(elems, c.Port)
		case "username": elems = append(elems, c.Username)
		case "password":
			if c.SecretKind == "PASSWORD" { elems = append(elems, c.Secret) } else { elems = append(elems, "") }
		case "private-key":
			if c.SecretKind == "KEY" { elems = append(elems, c.Secret) } else { elems = append(elems, "") }
		default: elems = append(elems, "")
		}
	}
	return encodeInstruction(elems...)
}
```

  > The arg-name set and any protocol-specific required params (e.g. `security`,
  > `ignore-cert` for rdp) come from Task 1's recorded output — extend the switch
  > with whatever the spike showed guacd asks for.

- [ ] **Step 4: Run to pass.** `cd dataplane && go test ./... -run 'TestEncode|TestParse|TestBuildConnect'` → PASS.

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add dataplane/guacproto.go dataplane/guacproto_test.go && git commit -m "feat(gateway): Guacamole protocol encode/parse + connect builder"
```

---

### Task 4: Manager descriptor API + control-client method

**Files:**
- Create: `src/app/api/internal/gateway/descriptor/route.ts`
- Modify: `dataplane/controlclient.go`

**Interfaces:**
- Consumes: `evaluateAccess` (`@/lib/access/evaluate`), `getVaultCredential` (`@/lib/vault/store`), DATAPLANE_SECRET gate (mirror `session/resolve`).
- Produces:
  - HTTP: `POST /api/internal/gateway/descriptor { userId, siteId }` → `{ protocol, targetHost, targetPort, username, secret, secretKind, guacdAddress }` or 403/404.
  - Go: `func (c *ControlClient) GatewayDescriptor(userID, siteID string) (GuacConn, string, error)` returning the `GuacConn` + guacdAddress.

- [ ] **Step 1: Implement the route.**

```ts
import { NextRequest, NextResponse } from "next/server";
import { evaluateAccess } from "@/lib/access/evaluate";
import { getVaultCredential } from "@/lib/vault/store";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dpAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

export async function POST(req: NextRequest) {
  if (!dpAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof b.userId === "string" ? b.userId : "";
  const siteId = typeof b.siteId === "string" ? b.siteId : "";
  if (!userId || !siteId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true } });
  if (!site || site.accessMode !== "GATEWAY") return NextResponse.json({ error: "not_gateway" }, { status: 404 });

  const decision = await evaluateAccess(userId, siteId, new Date());
  if (!decision.allow) return NextResponse.json({ error: "forbidden", reason: decision.reason }, { status: 403 });

  const cred = await getVaultCredential(siteId);
  if (!cred) return NextResponse.json({ error: "no_credential" }, { status: 404 });

  return NextResponse.json({
    protocol: cred.protocol.toLowerCase(),
    targetHost: cred.targetHost,
    targetPort: cred.targetPort,
    username: cred.username,
    secret: cred.secret,
    secretKind: cred.secretKind,
    guacdAddress: (process.env.GUACD_ADDR ?? "guacd:4822").trim(),
  });
}
```

- [ ] **Step 2: Add the Go control-client method.** In `dataplane/controlclient.go`, mirror `ResolveSession`:

```go
func (c *ControlClient) GatewayDescriptor(userID, siteID string) (GuacConn, string, error) {
	var out struct {
		Protocol, TargetHost, Username, Secret, SecretKind, GuacdAddress string
		TargetPort int
	}
	err := c.post("/api/internal/gateway/descriptor", map[string]string{"userId": userID, "siteId": siteID}, &out)
	if err != nil {
		return GuacConn{}, "", err
	}
	return GuacConn{
		Protocol: out.Protocol, Hostname: out.TargetHost, Port: strconv.Itoa(out.TargetPort),
		Username: out.Username, Secret: out.Secret, SecretKind: out.SecretKind,
	}, out.GuacdAddress, nil
}
```
  (Add `"strconv"` to the imports if not present. Match the existing `c.post` signature — check how `ResolveSession` calls it.)

- [ ] **Step 3: Build.** `cd dataplane && go build ./...` OK; `pnpm build` (manager) OK.

- [ ] **Step 4: Commit.**

```bash
cd /opt/captivo-access && git add src/app/api/internal/gateway/descriptor/route.ts dataplane/controlclient.go && git commit -m "feat(gateway): manager descriptor API + data-plane client"
```

---

### Task 5: Data-plane guac-tunnel WebSocket endpoint — **spike-informed**

**Files:**
- Create: `dataplane/guactunnel.go`
- Modify: `dataplane/main.go`

**Interfaces:**
- Consumes: `dialGuacd` (a `dialLdap` clone opening a `guacd`-kind relay through the connector — add it beside `dialLdap` in `dataplane/ldap.go` or a new `dataplane/guacdial.go`); `ControlClient.ResolveSession`, `ControlClient.GatewayDescriptor`; `encodeInstruction`/`parseInstruction`/`buildConnect` (Task 3); the registry that maps a site → its connector session (as the browser proxy uses).

- [ ] **Step 1: Add `dialGuacd`.** Clone `dialLdap` (from `dataplane/ldap.go`) into a `dialGuacd(s *Session, target string) (net.Conn, error)` that sends a `tunnel.GuacdDialRequest{Kind:"guacd", Target: target}` and returns the relay stream (same request/response-frame handshake as `dialLdap`).

- [ ] **Step 2: Implement the WebSocket endpoint `dataplane/guactunnel.go`.** Accept the browser WebSocket, authenticate + authorize, open guacd, handshake, relay. Skeleton (fill the handshake from Task 1; use the repo's existing websocket dependency — check `wsproxy.go` for which library):

```go
package main

import ("bufio"; "net"; "net/http")

// serveGuacTunnel upgrades the browser WebSocket, authenticates the Captivo
// session, resolves the connection descriptor from the manager, opens guacd
// through the connector, performs the handshake injecting the credential, and
// relays the Guacamole protocol both ways.
func serveGuacTunnel(ctrl *ControlClient, reg *Registry, w http.ResponseWriter, r *http.Request) {
	siteID := r.URL.Query().Get("site")
	token := sessionCookie(r) // reuse the browser proxy's cookie read
	userID, _, err := ctrl.ResolveSession(token)
	if err != nil || userID == "" || siteID == "" { http.Error(w, "unauthorized", 401); return }

	conn, guacdAddr, err := ctrl.GatewayDescriptor(userID, siteID)
	if err != nil { http.Error(w, "forbidden", 403); return }

	sess := reg.forSite(siteID) // the connector session serving this site
	if sess == nil { http.Error(w, "connector offline", 502); return }
	guac, err := dialGuacd(sess, guacdAddr)
	if err != nil { http.Error(w, "guacd unreachable", 502); return }
	defer guac.Close()

	// Handshake (Task 1 sequence): select → read args → size/audio/video/image → connect → ready.
	br := bufio.NewReader(guac)
	_, _ = guac.Write(encodeInstruction("select", conn.Protocol))
	op, argNames, err := parseInstruction(br)
	if err != nil || op != "args" { http.Error(w, "handshake failed", 502); return }
	_, _ = guac.Write(encodeInstruction("size", "1024", "768", "96"))
	_, _ = guac.Write(encodeInstruction("audio"))
	_, _ = guac.Write(encodeInstruction("video"))
	_, _ = guac.Write(encodeInstruction("image"))
	_, _ = guac.Write(buildConnect(argNames, conn))
	if op, _, err = parseInstruction(br); err != nil || op != "ready" { http.Error(w, "not ready", 502); return }

	// Upgrade + relay: browser text/binary frames <-> guacd bytes. Use the same
	// websocket library wsproxy.go uses; pipe br (already-buffered guacd) both ways.
	upgradeAndRelay(w, r, guac, br) // implement with the repo's ws lib (see wsproxy.go)
}
```
  > `sessionCookie`, `reg.forSite`, and `upgradeAndRelay` are named for intent —
  > wire them to the exact helpers `browserproxy.go`/`wsproxy.go`/`registry.go`
  > already expose (cookie read, site→session lookup, ws upgrade + copy loop).
  > The size/audio/video/image values may need to come from the browser's opening
  > frames per Task 1 — adjust to the confirmed sequence.

- [ ] **Step 3: Mount it in `main.go`.** Add a route (e.g. on the proxy mux or a dedicated path) `"/guac-tunnel"` calling `serveGuacTunnel(ctrl, reg, w, r)`. Note in the plan's deploy section that the host nginx must forward this path to the data-plane with WebSocket upgrade headers.

- [ ] **Step 4: Build.** `cd dataplane && go build ./...` OK.

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add dataplane/guactunnel.go dataplane/guacdial.go dataplane/main.go dataplane/ldap.go && git commit -m "feat(gateway): data-plane guac-tunnel (auth + descriptor + handshake + relay)"
```

---

### Task 6: Frontend session page + gate + Open routing

**Files:**
- Create: `src/lib/gateway/native.ts`
- Create: `src/app/(app)/access/gateway/[siteId]/session/page.tsx` + a client `session-client.tsx`
- Add: the bundled `guacamole-common-js` (like the rrweb recorder bundle) served/imported by the client
- Modify: `src/app/(app)/access/access-view.tsx`

**Interfaces:**
- Consumes: `Guacamole.Client`/`Guacamole.WebSocketTunnel` (browser); `AccessRow.accessMode` (already present).
- Produces: `nativeGatewayEnabled(): boolean`.

- [ ] **Step 1: Gate.** `src/lib/gateway/native.ts`:

```ts
export function nativeGatewayEnabled(): boolean {
  const v = process.env.NATIVE_GATEWAY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
```

- [ ] **Step 2: Bundle `guacamole-common-js`.** `pnpm add guacamole-common-js`, then produce a browser bundle the client page imports (follow the rrweb recorder pattern in `src/recorder/`; if a direct `import Guacamole from "guacamole-common-js"` works in the Next client component, prefer that and skip the manual bundle).

- [ ] **Step 3: Session client component `session-client.tsx`.** Creates a `Guacamole.WebSocketTunnel` to `wss://<manager-host>/guac-tunnel?site=<siteId>` (the data-plane path fronted by nginx), a `Guacamole.Client`, attaches keyboard + mouse, appends the display to a full-page container, and connects. Handle close/error states with a message.

- [ ] **Step 4: Session page `page.tsx` (server).** `requireUser()`, load the site (must be GATEWAY + `nativeGatewayEnabled()`), render `<SessionClient siteId={id} />` full-bleed. If the gate is off or the site isn't a native gateway, redirect to the json-auth launch.

- [ ] **Step 5: Route Open.** In `access-view.tsx` `RowAction`, for `status === "active"` and `accessMode === "GATEWAY"`: link to `/access/gateway/${r.siteId}/session` **when native is on**. Since the gate is server-side, thread a `nativeGateway: boolean` prop from the page (read `nativeGatewayEnabled()` in `access/page.tsx` and pass it into `AccessView`), and choose session-page vs launch accordingly.

- [ ] **Step 6: Build.** `pnpm build` OK.

- [ ] **Step 7: Gate A (operator).** `NATIVE_GATEWAY=1`, a GATEWAY site with a vault credential + a reachable guacd + real RDP/SSH/VNC target → Open renders the session inside Captivo (no Guacamole UI), no password entry; denied grant is refused; gate off falls back to json-auth.

- [ ] **Step 8: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/gateway/native.ts "src/app/(app)/access/gateway" "src/app/(app)/access/access-view.tsx" "src/app/(app)/access/page.tsx" package.json pnpm-lock.yaml && git commit -m "feat(gateway): native session page + client + NATIVE_GATEWAY gate"
```

---

## Deployment (after all tasks reviewed + spike confirmed)

- Data-plane + connector image bumps (new relay + tunnel). Manager image bump.
- Host nginx: forward `/guac-tunnel` (or a dedicated subdomain) to the data-plane with WebSocket upgrade headers, alongside the existing proxy/WSS routes.
- Gateway pack: guacd already present; ensure the connector's `ALLOWED_TARGETS` (if set) permits the guacd address; set `GUACD_ADDR` on the manager if not the default.
- `NATIVE_GATEWAY` stays off until validated at Gate A. No schema change (guacdAddress is env-defaulted).

## Self-Review

**Spec coverage:**
- Connector guacd relay → Task 2. ✓
- Data-plane WS tunnel (auth + descriptor + handshake + relay) → Task 5, using Task 3 (handshake) + Task 4 (descriptor). ✓
- Manager descriptor API (grant + vault decrypt) → Task 4. ✓
- guacamole-common-js session page → Task 6. ✓
- RDP/SSH/VNC → `buildConnect` fills per-protocol args (Task 3), protocol from the descriptor. ✓
- Capability gate alongside json-auth → Task 6 (`NATIVE_GATEWAY`, Open routing). ✓
- Credential only in manager, injected server-side, never to browser → Task 4 (descriptor over internal API) + Task 5 (connect instruction). ✓
- De-risk spike gating handshake/tunnel → Task 1 (gates 3, 5). ✓
- Recording/replay + retire-old are out of scope → not in this plan (Slices 2, 3). ✓

**Placeholder scan:** Tasks 3 and 5 carry explicit "spike-informed / adjust to Task 1's recorded sequence" notes — these are a real integration dependency (the exact guacd arg order), not placeholders; the code given is the concrete leading implementation. All other steps have concrete code.

**Type consistency:** `GuacConn` defined in Task 3, produced by `ControlClient.GatewayDescriptor` (Task 4), consumed by `buildConnect` (Task 3) in the Task 5 handshake. `GuacdDialRequest{Kind,Target}` (Task 2) used by `dialGuacd` (Task 5) + `handleGuacd` (Task 2). Descriptor JSON fields (`protocol/targetHost/targetPort/username/secret/secretKind/guacdAddress`) identical between the route (Task 4 TS) and the Go client struct (Task 4 Go). `nativeGatewayEnabled()` (Task 6) mirrors `vaultEnabled()`.
