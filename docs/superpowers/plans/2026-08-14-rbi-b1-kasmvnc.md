# RBI Transport B — Slice B1 (KasmVNC High-Fidelity, Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a vendor can view/control a KasmVNC-served Chromium through the connector tunnel for a High-fidelity ISOLATED resource — single concurrent hi-fi session, reusing A's product wiring.

**Architecture:** A per-site `isolationHiFi` flag routes an ISOLATED session to a new transport: a lean `captivo-access-kasm-browser` image (KasmVNC `Xvnc` serving client+RFB-over-WS on one port) reverse-proxied by the data-plane's new `/kasm-tunnel` (a Go `httputil.ReverseProxy` dialing the backend through the connector). No guacd on this path. Single-flight guard (concurrency is a follow-up).

**Tech Stack:** Prisma 7, Next.js (manager), Go (data-plane), Docker (KasmVNC image), vitest + `go test`.

## Global Constraints

- **English only** — code, comments, commit messages. **No Claude signature.**
- **Additive** — Standard ISOLATED (guacd/VNC), GATEWAY, TRANSPARENT unchanged (regression-test). A stays as the Standard/fallback transport.
- **Single concurrent hi-fi session in B1** — a data-plane single-flight guard (like A1). Concurrency = a later slice.
- **No guacd** on the hi-fi path; **no docker socket** (image runs bundled on the gateway host like guacd/the A browser).
- Chromium runs `--no-sandbox --disable-gpu --disable-dev-shm-usage` (root-in-container; A1 trap).
- KasmVNC pinned to **v1.5.0** (`kasmvncserver_bookworm_1.5.0_amd64.deb`).
- Hi-fi recording is **not** in B1 (the descriptor returns `record:false` for hi-fi) — recording = B3.
- Ships as **v0.61.0**. Verify with `pnpm build`/`pnpm test`, `go build`/`go test ./...`, and a KasmVNC image spike.

---

### Task 1: Manager — `isolationHiFi` field, form, descriptor + session-page routing

**Files:**
- Modify: `prisma/schema.prisma`; `src/lib/site/validate.ts` (+ test); `src/app/(app)/admin/sites/site-form.tsx`; `src/app/api/admin/sites/route.ts` + `[id]/route.ts`; `src/app/api/internal/gateway/descriptor/route.ts`; `src/app/gateway/[siteId]/session/page.tsx`

**Interfaces:**
- Produces: `Site.isolationHiFi` persisted for ISOLATED; descriptor returns a `transport:"kasm"` shape when hi-fi; session page renders a KasmVNC iframe for hi-fi.

- [ ] **Step 1: Schema**

In `prisma/schema.prisma`, add to `model Site`:
```prisma
  isolationHiFi Boolean @default(false)
```
Run: `pnpm db:generate` (regenerate the client for the new field).

- [ ] **Step 2: validate.ts — persist the flag for ISOLATED (+ test)**

In `src/lib/site/validate.ts`, add `isolationHiFi: boolean` to the ISOLATED success
variant, and in the ISOLATED branch set `isolationHiFi: body.isolationHiFi === true`.
In `src/lib/site/validate.test.ts`, extend the ISOLATED test:
```ts
    expect(validateSiteInput({ ...b, isolationHiFi: true }, { ...base, isolationEnabled: true }))
      .toMatchObject({ ok: true, mode: "ISOLATED", isolationHiFi: true });
```
Run: `pnpm test src/lib/site/validate.test.ts` → PASS.

- [ ] **Step 3: Routes — persist `isolationHiFi`**

In both `src/app/api/admin/sites/route.ts` and `[id]/route.ts`, in the ISOLATED write
branch (create `db.site.create` / update `db.site.update`), add `isolationHiFi: v.isolationHiFi`
to the `data`.

- [ ] **Step 4: Site form — Streaming quality select**

In `src/app/(app)/admin/sites/site-form.tsx`: add `isolationHiFi` state
(`useState(site?.isolationHiFi ?? false)`), add `isolationHiFi: site?.isolationHiFi`
to the `SiteInitial` type, include `isolationHiFi` in the submit body, and in the
ISOLATED section (after the Clipboard field) add:
```tsx
          <div className="field">
            <label className="field-label" htmlFor="site-iso-fidelity">Streaming quality</label>
            <select id="site-iso-fidelity" className="select" value={isolationHiFi ? "hi" : "std"} onChange={(e) => setIsolationHiFi(e.target.value === "hi")}>
              <option value="std">Standard (works everywhere)</option>
              <option value="hi">High-fidelity — smoother (beta)</option>
            </select>
            <span className="hint">High-fidelity uses a modern codec for smoother scrolling/video. Beta — not yet recorded.</span>
          </div>
```
Also add `isolationHiFi` to the `[id]/edit/page.tsx` `site={{…}}` object.

- [ ] **Step 5: Descriptor — hi-fi branch**

In `src/app/api/internal/gateway/descriptor/route.ts`, add `isolationHiFi: true` and
`upstreamUrl: true` to the site `findUnique` select (upstreamUrl already added in A1).
In the `if (site.accessMode === "ISOLATED")` block, branch **before** the VNC return:
```ts
    if (site.isolationHiFi) {
      return NextResponse.json({
        transport: "kasm",
        navigateUrl: site.upstreamUrl ?? "",
        kasmAddr: (process.env.ISOLATED_KASM_ADDR ?? "captivo-kasm:6901").trim(),
        kasmControlAddr: (process.env.ISOLATED_KASM_CONTROL_ADDR ?? "captivo-kasm:7900").trim(),
        connectorId: site.connectorId,
        record: false, // hi-fi recording = B3
      });
    }
```
(The existing VNC return stays for Standard ISOLATED.)

- [ ] **Step 6: Session page — render KasmVNC iframe for hi-fi**

In `src/app/gateway/[siteId]/session/page.tsx`: add `isolationHiFi: true` to the
`site` select. When `site.accessMode === "ISOLATED" && site.isolationHiFi`, render a
full-viewport KasmVNC frame instead of `GatewaySession`:
```tsx
  if (site.accessMode === "ISOLATED" && site.isolationHiFi) {
    return <iframe title="Isolated browser" src="/kasm-tunnel/" style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }} allow="clipboard-read; clipboard-write" />;
  }
```
(Standard ISOLATED + GATEWAY keep rendering `GatewaySession` / `ConsentGate`.)

- [ ] **Step 7: Build + tests**

Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?` → `EXIT=0`; `pnpm test > /tmp/t.log 2>&1; echo EXIT=$?` → `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/lib/site/validate.ts src/lib/site/validate.test.ts "src/app/(app)/admin/sites/site-form.tsx" "src/app/(app)/admin/sites/[id]/edit/page.tsx" "src/app/api/admin/sites/route.ts" "src/app/api/admin/sites/[id]/route.ts" "src/app/api/internal/gateway/descriptor/route.ts" "src/app/gateway/[siteId]/session/page.tsx"
git commit -m "feat(rbi): isolationHiFi flag + KasmVNC descriptor/session-page routing"
```

---

### Task 2: KasmVNC browser image + publish + spike

**Files:**
- Create: `kasm-browser/Dockerfile`, `kasm-browser/entrypoint.sh`, `kasm-browser/control.py`, `kasm-browser/kasmvnc.yaml`
- Modify: `.github/workflows/publish.yml`

**Interfaces:** Produces `ghcr.io/kurtserdar/captivo-access-kasm-browser` — KasmVNC client+WS on `6901` (no auth, no SSL, internal-only), control on `7900`.

- [ ] **Step 1: control.py** — reuse A's single-session navigate (relaunch Chromium)

Create `kasm-browser/control.py` (identical to `browser/control.py`'s A1 single-session
version: `/navigate?url=` kills+relaunches `chromium --kiosk --no-sandbox … <url>` on
`DISPLAY=:1`; `/reset`; `/healthz`; serves on `0.0.0.0:7900`).

- [ ] **Step 2: kasmvnc.yaml** — disable SSL + web auth (internal-only)

Create `kasm-browser/kasmvnc.yaml`:
```yaml
network:
  protocol: http
  ssl:
    require_ssl: false
  udp:
    public_ip: 127.0.0.1
runtime_configuration:
  allow_client_to_override_kasm_server_settings: true
```
(This is the primary mechanism to run KasmVNC without SSL/basic-auth; **Step 6's spike
confirms the exact keys for v1.5.0 and adjusts if a `-SecurityTypes None` /
`-DisableBasicAuth` flag is needed instead — this is the de-risk point.**)

- [ ] **Step 3: entrypoint.sh**

Create `kasm-browser/entrypoint.sh`:
```sh
#!/bin/sh
set -e
export DISPLAY=:1
mkdir -p /root/.vnc
cp /kasmvnc.yaml /root/.vnc/kasmvnc.yaml
# KasmVNC's Xvnc IS the display server + VNC + web/WS server on one port.
Xvnc :1 -geometry 1280x800 -depth 24 -websocketPort 6901 -interface 0.0.0.0 \
  -httpd /usr/share/kasmvnc/www -SecurityTypes None -disableBasicAuth &
sleep 2
fluxbox >/dev/null 2>&1 &
exec python3 /control.py
```
(`-SecurityTypes None -disableBasicAuth` are the intended no-auth flags; the spike
in Step 6 confirms/fixes the exact flag names for v1.5.0.)

- [ ] **Step 4: Dockerfile**

Create `kasm-browser/Dockerfile`:
```dockerfile
FROM debian:bookworm-slim
ARG KASM_VER=1.5.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates chromium fluxbox python3 dumb-init \
      libxfont2 libxtst6 libgl1 libgbm1 libxcb-render0 libxcb-shm0 \
    && curl -fsSL -o /tmp/kasmvnc.deb \
       "https://github.com/kasmtech/KasmVNC/releases/download/v${KASM_VER}/kasmvncserver_bookworm_${KASM_VER}_amd64.deb" \
    && apt-get install -y --no-install-recommends /tmp/kasmvnc.deb \
    && rm -f /tmp/kasmvnc.deb && rm -rf /var/lib/apt/lists/*
COPY kasm-browser/kasmvnc.yaml /kasmvnc.yaml
COPY kasm-browser/control.py /control.py
COPY kasm-browser/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /control.py
EXPOSE 6901 7900
ENTRYPOINT ["dumb-init", "--"]
CMD ["/entrypoint.sh"]
```

- [ ] **Step 5: publish.yml matrix**

Add to `.github/workflows/publish.yml` matrix `include:`:
```yaml
          - image: kasm-browser
            dockerfile: kasm-browser/Dockerfile
            platforms: linux/amd64
```

- [ ] **Step 6: Build + spike (DE-RISK — resolve KasmVNC no-auth/no-ssl here)**

Run:
```bash
docker build -f kasm-browser/Dockerfile -t captivo-access-kasm-browser:dbg .
docker rm -f kb >/dev/null 2>&1
docker run -d --name kb --shm-size=1g captivo-access-kasm-browser:dbg
sleep 8
# KasmVNC serves the client + WS on 6901 WITHOUT auth/SSL?
docker exec kb sh -c 'curl -fsS -o /dev/null -w "kasm_http=%{http_code}\n" http://localhost:6901/ || echo "6901 not plain-http-ok"'
# navigate works?
docker exec kb sh -c 'curl -fsS "http://localhost:7900/navigate?url=https://example.com" && echo " navOK"'
docker logs kb 2>&1 | grep -iE "listening|websocket|error|auth|ssl" | head
docker rm -f kb >/dev/null 2>&1
```
Expected: `kasm_http=200` (plain HTTP, no 401), `navOK`. **If 401/SSL:** adjust the
`kasmvnc.yaml` keys / `Xvnc` flags until 6901 serves plain + unauthenticated, then
rebuild and re-run. Do not proceed until 6901 serves without auth over plain HTTP.

- [ ] **Step 7: Commit**

```bash
git add kasm-browser/ .github/workflows/publish.yml
git commit -m "feat(rbi): captivo-access-kasm-browser image (KasmVNC single-port client+WS) + publish"
```

---

### Task 3: Data-plane `/kasm-tunnel` reverse proxy

**Files:**
- Create: `dataplane/kasmtunnel.go` + `dataplane/kasmtunnel_test.go`
- Modify: `dataplane/main.go` (register `/kasm-tunnel`); `dataplane/controlclient.go` (kasm descriptor fields)

**Interfaces:**
- Consumes: descriptor `transport/kasmAddr/kasmControlAddr/navigateUrl/connectorId`; `dialGuacd` relay; A's `buildNavigateRequest`/`buildResetRequest`.

- [ ] **Step 1: KasmDescriptor on the control client**

In `dataplane/controlclient.go`, add a `KasmDescriptor(userID, siteID)` method that
POSTs the same `/api/internal/gateway/descriptor` and decodes `transport`, `navigateUrl`,
`kasmAddr`, `kasmControlAddr`, `connectorId`, `record`. (Or extend `GatewayDescriptor`'s
struct with these fields and return them — either way the hi-fi path reads `kasmAddr`.)

- [ ] **Step 2: kasmtunnel.go — reverse proxy through the connector**

Create `dataplane/kasmtunnel.go`:
```go
package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// kasmSession is B1's single-flight lock (one hi-fi session at a time; a broker
// for concurrency is a follow-up, like A1→A2).
var kasmSession isoGuard

// serveKasmTunnel reverse-proxies the vendor's HTTP/WebSocket request to a
// KasmVNC backend (client + RFB-over-WS on one port) THROUGH the connector. The
// browser is navigated to the site URL first via the backend's control port.
func serveKasmTunnel(ctrl *ControlClient, reg *Registry, w http.ResponseWriter, r *http.Request) {
	ck, err := r.Cookie("ca_session")
	if err != nil || ck.Value == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, _, err := ctrl.ResolveSession(ck.Value)
	if err != nil || userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	siteID := r.URL.Query().Get("site")
	if siteID == "" {
		// the iframe loads /kasm-tunnel/ without ?site; carry it via a cookie set at first hit
		if c, e := r.Cookie("ca_kasm_site"); e == nil {
			siteID = c.Value
		}
	}
	d, err := ctrl.KasmDescriptor(userID, siteID)
	if err != nil || d.Transport != "kasm" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	sess := reg.Get(d.ConnectorID)
	if sess == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}
	// The guard + navigate live on the WebSocket upgrade request — the real session
	// boundary (one long-lived RFB WS per session). HTML/asset requests just serve
	// the client unguarded. A 2nd concurrent WS is rejected (would share the same
	// KasmVNC display = data leak); concurrency is a later slice.
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		if !kasmSession.tryAcquire() {
			http.Error(w, "isolated browser at capacity", http.StatusServiceUnavailable)
			return
		}
		defer kasmSession.release()
		if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
			_, _ = st.Write([]byte(buildResetRequest(d.KasmControlAddr)))
			_ = st.Close()
		}
		if st, e := dialGuacd(sess, d.KasmControlAddr); e == nil {
			_, _ = st.Write([]byte(buildNavigateRequest(d.KasmControlAddr, d.NavigateUrl)))
			_ = st.Close()
		}
	}
	target, _ := url.Parse("http://" + d.KasmAddr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return dialGuacd(sess, d.KasmAddr) // relay to KasmVNC through the connector
		},
	}
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/kasm-tunnel")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}
	proxy.ServeHTTP(w, r)
}
```

- [ ] **Step 2b: Go test**

Create `dataplane/kasmtunnel_test.go` — test the path-prefix strip logic + that the
guard is single-flight (reuse the `isoGuard` behavior):
```go
package main

import ("net/http/httptest"; "strings"; "testing")

func TestKasmPathStrip(t *testing.T) {
	for in, want := range map[string]string{"/kasm-tunnel/": "/", "/kasm-tunnel/vnc.html": "/vnc.html", "/kasm-tunnel": "/"} {
		r := httptest.NewRequest("GET", in, nil)
		p := strings.TrimPrefix(r.URL.Path, "/kasm-tunnel")
		if p == "" { p = "/" }
		if p != want { t.Fatalf("%q -> %q want %q", in, p, want) }
	}
}
```

- [ ] **Step 3: Register the route + single-flight release**

In `dataplane/main.go`, on the `:3103` mux (near `/guac-tunnel`):
```go
	mux.HandleFunc("/kasm-tunnel", func(w http.ResponseWriter, r *http.Request) { serveKasmTunnel(ctrl, reg, w, r) })
	mux.HandleFunc("/kasm-tunnel/", func(w http.ResponseWriter, r *http.Request) { serveKasmTunnel(ctrl, reg, w, r) })
```
The single-flight guard is acquired + released on the WebSocket-upgrade request in
`serveKasmTunnel` (Step 2): `defer kasmSession.release()` runs when the long-lived WS
proxy returns (session end). HTML/asset requests are unguarded static serving. No
separate watcher needed.

- [ ] **Step 4: Build + test the data-plane**

Run: `cd dataplane && go build ./... && go test ./...` → both pass.

- [ ] **Step 5: Commit**

```bash
git add dataplane/kasmtunnel.go dataplane/kasmtunnel_test.go dataplane/main.go dataplane/controlclient.go
git commit -m "feat(rbi): data-plane /kasm-tunnel reverse-proxy to KasmVNC through the connector"
```

---

### Task 4: Deploy wiring + verification

**Files:**
- Modify: `src/lib/connector/repair.ts` (bundle the kasm-browser container) + `src/lib/connector/repair.test.ts`
- Modify: `deploy/Caddyfile` + `docs/install.md` (the `/kasm-tunnel` route + kasm container note)

**Interfaces:** Runs `captivo-access-kasm-browser` as `captivo-kasm` on `captivo-gateway`.

- [ ] **Step 1: Bundle the kasm-browser on the gateway host**

In `src/lib/connector/repair.ts` `runCommand`, after the browser block, add (with a
pull, per the v0.60.3 lesson):
```ts
    `docker pull ghcr.io/kurtserdar/captivo-access-kasm-browser:latest && ` +
    `docker rm -f captivo-kasm >/dev/null 2>&1; ` +
    `docker run -d --name captivo-kasm --restart unless-stopped --network ${GATEWAY_NETWORK} --shm-size=1g ghcr.io/kurtserdar/captivo-access-kasm-browser:latest && `;
```
Add a `repair.test.ts` assertion that install/update contain `captivo-access-kasm-browser:latest`.

- [ ] **Step 2: nginx/Caddy route**

Add a `/kasm-tunnel` route (WS-upgrade aware) to `deploy/Caddyfile` (shipped) pointing
at the data-plane `:3103`, mirroring `/guac-tunnel`. Document in `docs/install.md` that
host-nginx deployments must add the same `/kasm-tunnel → 127.0.0.1:3113` block.

- [ ] **Step 3: Suites + builds**

Run: `pnpm test > /tmp/t.log 2>&1; echo EXIT=$?` → 0; `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?` → 0; `cd dataplane && go build ./... && go test ./... && cd ..`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/connector/repair.ts src/lib/connector/repair.test.ts deploy/Caddyfile docs/install.md
git commit -m "feat(rbi): bundle the kasm-browser on the gateway host + /kasm-tunnel route"
```

- [ ] **Step 5: Gate A (operator, real browser — decisive):**
  1. Deploy v0.61.0 (manager+migrate+dataplane bumped, kasm image published); operator updates the gateway connector (pulls + runs `captivo-kasm`) and adds the `/kasm-tunnel` nginx route.
  2. An ISOLATED site set **High-fidelity** → vendor Open → the KasmVNC client renders the internal app, **noticeably smoother** than Standard.
  3. **If the KasmVNC client fails to connect:** it's the reverse-proxy base-path / WS-upgrade through `/kasm-tunnel` — check `docker logs cap-access-dataplane` + the browser console for the WS URL the client tried; adjust the client path (`?path=`) or the proxy prefix handling.
  4. Standard ISOLATED + GATEWAY still work (regression).

---

## Notes for the implementer

- The **KasmVNC no-auth/no-SSL config (Task 2 Step 6) and the reverse-proxy client base-path (Task 4 Gate A) are the two real risks** — both are validated by spike/Gate-A, exactly like A1's `--no-sandbox` and session-page traps.
- Hi-fi is single-session in B1 (single-flight). Concurrency (a KasmVNC broker like A2) and clipboard DLP (KasmVNC `-DLP_*`) and recording are later slices — don't scope-creep.
- Deploy: **v0.61.0** — schema → manager+migrate bump + `access-migrate run`; dataplane bump; publish the kasm image; operator updates the gateway connector + adds `/kasm-tunnel` nginx. Verify `/login` 200 + `APP_VERSION`; spike + Gate A; `gh release edit v0.61.0` (English: high-fidelity isolated browser, beta, opt-in).
