# Isolated Live Monitoring — Slice 1: Visibility + Terminate — Design

**Date:** 2026-08-14
**Status:** Approved (design)
**Part of:** Isolated live monitoring full-parity roadmap (Slice 2 = watch + take-control).

## Goal

Register ISOLATED (KasmVNC) sessions in the data-plane SessionHub so they appear in
the console Live surfaces alongside GATEWAY sessions and can be force-terminated by
an admin — closing the current gap where isolated sessions are invisible and
un-terminable.

## Non-goals (Slice 2)

- Live screen watching of isolated sessions (the `/kasm-view` relay + KasmLiveViewer).
- Take-control of isolated sessions.
- The Xvnc second-shared-client spike (only needed for watch).

Slice 1 is deliberately watch-free: it needs no new WebSocket relay and no Xvnc
behaviour change, so it ships with low risk and immediate value.

## Global constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not change the GATEWAY guac path, the transparent browserproxy, or the isolated
  connect/recording behaviour — only ADD hub registration around the existing kasm
  proxy.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota is full — inline execution only.

## Architecture

Today `serveGuacTunnel` registers each GATEWAY session in the `SessionHub` (giving
Live cards + terminate + watch); `serveKasmTunnel` does not register at all. Slice 1
makes `serveKasmTunnel` register its per-session browser in the hub with a new
`kind = "isolated"`, wires a terminate closer, and surfaces the isolated sessions in
the manager's Live views. Terminate reuses the existing hub `Terminate` path.

### Data-plane

**`sessionhub.go` — a `kind` discriminator.**
- `liveSession` gains a `kind` field; `SessionInfo` gains `Kind string` (JSON
  `kind`). The existing `Register(...)` sets `kind = "gateway"`.
- Add `RegisterIsolated(sessionID, siteID, userID, host string, startedAt time.Time,
  connectorID string) *liveSession` that sets `kind = "isolated"` (isolated has no
  guacd `connID`/`guacdAddr`; those stay empty — Slice 2 adds the kasm attach info).
- `List()` includes `Kind` in each `SessionInfo`.

**`kasmtunnel.go` — register + terminate closer.**
- `serveKasmTunnel` takes the `*SessionHub` as a parameter.
- After a per-session browser is opened (broker `id` + `port` known, `backendAddr`
  set) and BEFORE `proxy.ServeHTTP`, mint a manager-facing `sessionID :=
  newSessionID()` and `hub.RegisterIsolated(sessionID, siteID, userID,
  d.NavigateUrl, time.Now(), d.ConnectorID)`; `defer hub.Remove(sessionID)`.
- Terminate closer: the reverse-proxy `Transport.DialContext` already dials the
  backend relay conn once per WS. Capture that `net.Conn` under a mutex, and
  `hub.SetCloser(sessionID, func(){ closeCapturedConn() })`. Closing the relay conn
  ends `proxy.ServeHTTP`, which unwinds the existing deferred broker
  `POST /session/<id>/close` (kills Xvnc/Chromium) and the recording teardown — so
  terminate reuses the normal cleanup path, just triggered early.
- `Protocol` for isolated is stored as `"isolated"`, `Host` as `d.NavigateUrl` (the
  target the isolated browser points at) — the console renders its own ISOLATED chip
  and shows this host.

**`main.go` — pass the hub.** The two `serveKasmTunnel(ctrl, reg, w, r)` call sites
(`/kasm-tunnel` and `/kasm-tunnel/`) become `serveKasmTunnel(ctrl, reg, hub, w, r)`.
The existing `/sessions/terminate` internal endpoint (already `hub.Terminate`) needs
no change.

### Manager

**`lib/dataplane/client.ts` — carry `kind`.** `ActiveSession` gains
`kind: "gateway" | "isolated"`. `listActiveSessions()` already returns the raw hub
rows, so the field flows through once the type includes it.

**`lib/console/data.ts` — split the union by kind.**
- `LiveCard` gains `{ kind: "isolated"; sessionId: string; host: string; userLabel:
  string; startedAt: string; recorded: boolean; viewerCount: number }`.
- The `sessions` array (from `listActiveSessions`) now holds both kinds. Partition it:
  `kind === "gateway"` → existing gateway cards; `kind === "isolated"` → isolated
  cards. Isolated `recorded` is derived exactly like gateway's
  (`recEnabled && recMap.get(s.siteId)`). The live KPI count already equals
  `sessions.length + webSessions.length`, so isolated sessions are counted with no
  change.

**`_console/security-console.tsx` — isolated card.** A third card branch for
`kind === "isolated"`: an "ISOLATED" chip, the target host, the recording indicator,
and the `TerminateButton` (reusing the existing component with the isolated
`sessionId`). **No "Watch live" link in Slice 1** — it arrives in Slice 2.

**`(app)/admin/live/live-table.tsx` — isolated rows.** The full Live table also reads
`listActiveSessions`; isolated rows render with an ISOLATED label and Terminate, and
must NOT show a Watch/Control action (guard those by `kind === "gateway"`) so the
table doesn't offer actions that don't exist yet.

## Data flow

1. Vendor opens an isolated session → `serveKasmTunnel` opens the per-session
   browser, registers it in the hub (`kind=isolated`) with a terminate closer, then
   reverse-proxies the WS.
2. Console `getConsoleData()` reads `listActiveSessions()` → isolated rows appear as
   isolated Live cards (and rows in `/admin/live`).
3. Admin clicks Terminate → `POST /api/admin/live/<id>/terminate` → data-plane
   `/sessions/terminate` → `hub.Terminate(id)` → closer closes the relay conn →
   `proxy.ServeHTTP` returns → deferred broker close kills the isolated browser;
   `hub.Remove` drops it from the Live list on the next poll.
4. Normal vendor disconnect → `proxy.ServeHTTP` returns → `hub.Remove` (deferred) →
   the session leaves the Live list.

## Error handling

- Terminate before the relay conn is dialed (microwindow between Register and the
  first `DialContext`): the captured conn is nil, the closer is a no-op, and the
  session proceeds normally — acceptable, as terminate targets established sessions.
- Data-plane down: `listActiveSessions()` already fails soft to `[]`; no isolated
  cards, no crash.
- Broker close best-effort as today (unchanged).

## Testing

- `go build ./...` + `go test ./...` in `dataplane/` green (add a hub unit test:
  `RegisterIsolated` sets `Kind == "isolated"` and `Terminate` invokes the closer).
- `pnpm build` green (union + card typecheck).
- Manual Gate after deploy:
  - Start an isolated session → it appears as an ISOLATED Live card + in `/admin/live`.
  - Click Terminate → the vendor's isolated browser session ends and the card
    disappears on the next poll.
  - GATEWAY and Web cards unchanged; gateway watch/terminate still work.

## Deploy

- Ships in the `manager` + `dataplane` images. No schema change → no migrate.
- Version bump + English `gh release edit` note. Deploy is a separate gate — do not
  auto-run.
