# Native HTML5 Gateway — Slice 1 (core tunnel) — Design

**Date:** 2026-08-11
**Status:** Approved for planning
**Area:** Pro tier / isolated sessions

## Problem

The gateway today publishes the **Guacamole web app** as a Captivo site: the vendor
lands in Guacamole's own UI (skinned to ROOT, header-auth SSO), and injection rides
a signed `guacamole-auth-json` blob. It works, but the vendor is in *their* UI, the
gateway pack carries a Tomcat webapp + Postgres + two auth extensions, and the
credential travels in a (sealed) blob through the browser.

CyberArk's PVWA instead embeds the HTML5 client directly: the user clicks Connect
and the remote session renders inside PVWA — Guacamole's web app is never seen.
This slice builds that model.

## Goal (Slice 1)

A vendor with a valid grant clicks **Open** on a native-gateway site and the
RDP/SSH/VNC session renders **inside a Captivo page** — no Guacamole web app, no
Guacamole login. The credential is injected into guacd **server-side** and never
reaches the browser in any form.

`guacd` (the protocol engine) stays; the **Guacamole web app is replaced** by our
own tunnel + embedded HTML5 client.

## Scope

**In scope (Slice 1):**
- Connector `guacd` raw-relay to reach guacd through the customer LAN.
- A data-plane WebSocket tunnel that authenticates the browser, resolves the
  connection descriptor (with credentials) from the manager, performs the guacd
  handshake injecting the credential, and relays the Guacamole protocol.
- A manager internal API returning the guacd connection descriptor for a
  (user, site) with a valid grant.
- A Captivo session page embedding `guacamole-common-js` (canvas + keyboard/mouse).
- RDP, SSH, and VNC (all just guacd connection args).
- A capability gate to route native-gateway sites here, alongside the existing
  json-auth gateway.
- A de-risk spike (Task 1) proving the guacd handshake + client render end to end.

**Out of scope (later slices):** recording + Captivo-native replay (Slice 2);
retiring the Guacamole web app / guac-postgres / header-auth / json-auth from the
gateway pack (Slice 3); clipboard/file-transfer, multi-monitor, session resize
polish; connection sharing/shadowing.

## Key decisions (approved)

1. **Order 1 → 2 → 3** (core tunnel, then recording+replay, then retire the old path).
2. **The credential lives only in the manager.** The data-plane asks the manager
   for the connection descriptor per session; the manager checks the grant,
   decrypts the vault secret, and returns it. The data-plane injects it into the
   guacd handshake and never persists it.
3. **The tunnel lives in the Go data-plane** — it already owns WebSocket handling
   and the connector relay; Node cannot stream through the connector. (Engineering
   conclusion, not a preference.)

## Architecture

```
Browser (guacamole-common-js in a Captivo page)
   │  WebSocket (Captivo session cookie)   Guacamole protocol
   ▼
Data-plane guac-tunnel (Go)  ──internal──▶ Manager: descriptor for (user,site)?  (grant check + vault decrypt)
   │  raw relay through the connector (new "guacd" kind)
   ▼
Connector ──raw TCP──▶ guacd:4822 (customer LAN) ──RDP/SSH/VNC──▶ target
```

### 1. Connector — `guacd` raw relay
A new stream kind `guacd` (a near-clone of `handleLdap`): validates the target
against `ALLOWED_TARGETS`, plain-TCP-dials guacd's `host:port`, and relays bytes
opaquely. guacd speaks the Guacamole protocol; the connector stays an opaque pipe.

### 2. Data-plane — guac-tunnel (the core)
A new WebSocket endpoint (fronted by the host nginx so the browser can reach it).
On connect:
1. Authenticate: read the Captivo session cookie, validate it via the control
   plane's `session/resolve` (already used by the browser proxy).
2. Authorize: the manager confirms the user has a live grant to the site and the
   site is a native gateway, and returns the **connection descriptor**:
   `{ protocol, targetHost, targetPort, username, secret, secretKind, guacdAddress }`.
3. Open a `guacd` raw relay through the site's connector to `guacdAddress`.
4. Perform the guacd handshake, mirroring `guacamole-lite`:
   `select <protocol>` → read `args` from guacd → forward the browser's
   `size`/`audio`/`video`/`image`/`timezone` → send `connect` with the arg values
   in guacd's order, filling `hostname/port/username/password` (or `private-key`)
   from the descriptor → guacd replies `ready`.
5. Relay the Guacamole protocol between the browser WebSocket and the guacd stream
   until either side closes.

The credential appears only inside step 4's `connect` instruction, server-side.

### 3. Manager — connection-descriptor internal API
An internal endpoint (data-plane-secret gated, like the other internal APIs) that,
given `(userId, siteId)`, runs `evaluateAccess`, and on allow returns the
descriptor above by reading the vault credential (decrypted) + the guacd address.
`guacdAddress` is a per-site value (default from an env convention, e.g.
`guacd:4822`, overridable later). Denied → the tunnel closes the WebSocket.

### 4. Frontend — Captivo session page
A page `/access/gateway/[siteId]/session` (client) that bundles
`guacamole-common-js` (packaged like the rrweb recorder bundle), creates a
`Guacamole.Client` over a `Guacamole.WebSocketTunnel` pointed at the data-plane
guac-tunnel (carrying only `siteId` — never credentials), attaches keyboard/mouse,
and renders the display full-page. For native-gateway sites the vendor's **Open**
navigates here instead of the json-auth launch.

## Capability gate

`NATIVE_GATEWAY` env (mirrors `vaultEnabled()`/`recordingEnabled()`), off by
default. When on, GATEWAY sites route **Open** to the native session page; when
off, they use the existing json-auth launch. This lets native run alongside the
proven path until Slice 3 retires the old one. A native-gateway session also
requires a vault credential (Slice 1 reuses `VaultCredential` as the descriptor
source).

## Error handling

- No session / expired session → the tunnel refuses the WebSocket (close code),
  the page shows "session expired, sign in again".
- Grant denied → tunnel closes; page shows "access denied".
- guacd unreachable / handshake failure → tunnel closes with a reason; page shows
  "couldn't reach the session host". The credential is never logged.
- Gate off or no vault credential → Open falls back to the json-auth launch (no
  hard failure).

## De-risk spike (Task 1)

Before building the slice: stand up guacd locally, write a minimal Go tunnel that
does the `select → args → connect(with creds) → ready` handshake against a real
RDP or SSH target, and a minimal `guacamole-common-js` page over a WebSocket to it.
Confirm the session renders. The handshake/relay half can be checked headlessly
(guacd accepts `connect` and streams drawing instructions); the "pixels on screen"
half is a browser check (Gate-A). This pins the handshake sequence and the client
wiring before the full slice is built. If guacd rejects the handshake or the client
won't render, revisit with the user before proceeding.

## Testing

- **Handshake encoder/parser (pure unit):** build a Guacamole instruction
  (`LENGTH.VALUE,…;`) and parse guacd's `args`, round-tripping known vectors —
  proves the wire format offline.
- **Descriptor authorization (pure where possible):** denied grant → no descriptor;
  allowed → descriptor with the decrypted secret.
- **Connector guacd relay:** target allowed → bytes relayed; disallowed →
  fail-closed (mirrors the LDAP relay tests).
- **Gate A (operator):** `NATIVE_GATEWAY=1`, a native-gateway site with a vault
  credential + a real RDP/SSH/VNC target → Open renders the session in Captivo,
  no Guacamole UI, no password entry; denied grant is refused.

## Deployment

- Data-plane + connector image bumps (new tunnel + relay). The gateway pack keeps
  guacd (already present); the Guacamole web app stays for now (retired in Slice 3).
- The data-plane guac-tunnel WebSocket must be reachable by the browser — add the
  host-nginx route (a path or subdomain) alongside the existing proxy/WSS routes.
- `NATIVE_GATEWAY` stays off until the operator turns it on. Schema: `guacdAddress`
  is env-defaulted in Slice 1 (a per-site column can come later); no required
  schema change if the env default is used.

## Risks (honest)

- **guacd handshake sequence** is the top risk — the collaborative `select/args/
  connect` dance with browser-provided display params. Task 1 de-risks it against a
  real guacd + target.
- **`guacamole-common-js` bundling** in the Next app (UMD/CJS lib) — mirror the
  rrweb bundling approach.
- **Browser reachability of the data-plane WebSocket** — needs an nginx route; the
  session cookie must be presented cross the right origin.
- **Gate A needs a running gateway + a real target**, so final validation is
  operator-run.
