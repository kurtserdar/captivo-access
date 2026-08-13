# Console Web-App Live Sessions — Design

**Status:** Approved (brainstorm 2026-08-13)
**Backlog:** punch-list #5 (console live cards cover web-app/transparent sessions)
**Ships as:** v0.44.0 (manager + dataplane; no schema, no migrate, no connector)

## Goal

The Security Console home shows live cards for gateway (guac) sessions but not
for web-app (transparent) access. Add web-app "sessions" to the same live grid so
an operator sees who is actively using an internal web app right now.

## Background / the crux

- **Gateway sessions are stateful** — a long-lived WS tunnel tracked in the
  data-plane `SessionHub`; `listActiveSessions()` reads `hub.List()`.
- **Web-app access is stateless** — `browserproxy.go` proxies each HTTP request
  independently; there is no session object. A vendor "using" a web app is a
  stream of allowed requests.

So a "live web-app session" must be **derived from activity**. Decision: a
**data-plane in-memory activity tracker** (chosen over an audit-derived query for
real-time accuracy), mirroring how `SessionHub` works.

## Decisions (resolved in brainstorm)

1. **Source:** data-plane in-memory `WebActivityTracker`.
2. **Live = recent activity:** a `(user, site)` is live if it proxied an allowed
   request within the **idle window** (default 120s, env-overridable).
3. **Action:** **Revoke access** — revokes the active grant for that `(user, site)`
   (reuses the existing grant-revoke endpoint; next request → 403). No Watch (no
   stream), no Terminate (no tunnel).
4. **Layout:** the same live grid, web cards carry a **"Web app"** badge.
5. **LIVE KPI** counts gateway + web.

## Architecture

### Data-plane — `WebActivityTracker` (`dataplane/webactivity.go`, new)

```go
type WebSessionInfo struct {
    UserID    string    `json:"userId"`
    SiteID    string    `json:"siteId"`
    Host      string    `json:"host"`
    StartedAt time.Time `json:"startedAt"` // first request in this active span
    LastSeen  time.Time `json:"lastSeen"`
}
type WebActivityTracker struct { mu sync.Mutex; m map[string]*WebSessionInfo; now func() time.Time }
func NewWebActivityTracker() *WebActivityTracker
func (t *WebActivityTracker) Touch(userID, siteID, host string) // key = userID+"\x1f"+siteID; upsert LastSeen (+StartedAt on first)
func (t *WebActivityTracker) List(idle time.Duration) []WebSessionInfo // prunes entries older than idle, returns the rest
```

- Thread-safe (mutex), like `SessionHub`. In-memory → lost on data-plane restart
  (acceptable; same as the hub).
- `Touch` is cheap and never blocks; `now` is injectable for tests.
- If `StartedAt` is older than the idle window but `LastSeen` is fresh, the entry
  stays (continuous activity); a gap longer than idle drops it, so a later request
  starts a new span.

### browserproxy wiring

`BrowserProxy` gains a `web *WebActivityTracker` field. At the single allowed-HTTP
emit point (`browserproxy.go:386`, right by
`p.audit.Enqueue(auditEvent("ALLOW", …))`), add:

```go
p.web.Touch(userID, siteID, host)
```

At that line `userID` is always known (anonymous requests were redirected to login
earlier) and `/__captivo/*` recorder/consent paths were already intercepted, so no
extra filtering is needed. WebSocket-upstream apps register via their HTTP requests
(a WS-only app is an accepted edge — see Out of scope).

### main.go

```go
web := NewWebActivityTracker()
proxy := &BrowserProxy{ …, web: web }
idle := time.Duration(envInt("WEB_SESSION_IDLE_SECS", 120, 15, 3600)) * time.Second
in.HandleFunc("/web-sessions", func(w, r) { /* secret-gate like /sessions */ writeJSON(w, 200, web.List(idle)) })
```

(`/web-sessions` is on the internal mux `in`, secret-gated exactly like
`/sessions`.)

### Manager — data-plane client (`src/lib/dataplane/client.ts`)

```ts
export interface WebSession { userId: string; siteId: string; host: string; startedAt: string; lastSeen: string }
export async function listActiveWebSessions(): Promise<WebSession[]> // GET /web-sessions, fails soft to []
```

### Console data (`src/lib/console/data.ts`)

- `getConsoleData()` also calls `listActiveWebSessions()`.
- Resolve for web cards: user label (extend the existing `userMap` with web userIds),
  site name (new `siteName` map over web siteIds), and the **active grant id** per
  `(user, site)`:
  `db.accessGrant.findMany({ where: { status: "ACTIVE", userId: { in }, siteId: { in } }, select: { id, userId, siteId } })`
  → `Map<userId+"\x1f"+siteId, grantId>` (first wins).
- `LiveCard` becomes a discriminated union:

```ts
export type LiveCard =
  | { kind: "gateway"; sessionId: string; protocol: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number }
  | { kind: "web"; userLabel: string; siteName: string; host: string; startedAt: string; lastSeen: string; grantId: string | null };
```

- Gateway cards get `kind: "gateway"` (otherwise unchanged). Web cards get
  `kind: "web"`. `kpis.live = gatewaySessions.length + webSessions.length`.

### Console UI (`src/app/(app)/_console/security-console.tsx`)

- Map over `live`, branch on `kind`.
  - `gateway`: existing card (Watch live + `TerminateButton`), unchanged.
  - `web`: a "Web app" badge, `userLabel · siteName · host`, "active {ago}" from
    `lastSeen`, and a **Revoke access** button (new `RevokeAccessButton`) — disabled
    when `grantId` is null.
- `RevokeAccessButton` (`_console/revoke-access-button.tsx`, new): confirm dialog →
  `DELETE /api/admin/grants?id=<grantId>` → `router.refresh()`. Mirrors the existing
  `revoke-grant-button.tsx`; reuses the existing endpoint (no new route).
- A pure `activeAgo(lastSeenIso, nowMs)` helper in `src/lib/console/format.ts`
  ("just now" / "Ns ago" / "Nm ago"), unit-tested.

## Testing

- **Go** (`webactivity_test.go`): Touch upserts; List prunes past the idle window;
  StartedAt preserved across touches within the window; a gap > idle drops then
  re-creates (new StartedAt); concurrent Touch/List safe (uses injectable `now`).
- **TS** (`format.test.ts`): `activeAgo` boundaries (0s → "just now", 45s → "45s
  ago", 130s → "2m ago").
- `pnpm build` typechecks the union + console + client.
- Gate-A (after deploy): browse an internal web app as a vendor → a "Web app" card
  appears in the console with the right user/site, "active …"; stop → within ~2 min
  it disappears; **Revoke access** → the vendor's next request 403s; gateway cards
  + Watch/Terminate unchanged; LIVE KPI counts both.

## Scope

- **This slice: the console home cards only.** The full `/admin/live` table stays
  gateway-only. Deliberate follow-up (the "All sessions →" link therefore shows
  only gateway sessions for now) — a later slice can extend the table with the same
  `listActiveWebSessions()`.

## Deploy

**v0.44.0**, manager + dataplane. No schema, no migrate, no connector. Bump both
tags, `docker compose up -d access-manager access-dataplane`.

## Out of scope

- `/admin/live` table web-app rows (follow-up).
- WebSocket-only apps that make no HTTP requests (rare; they'd under-report).
- Persisting activity across data-plane restarts (in-memory by design).
- Watch/Terminate for web sessions (impossible/meaningless — Revoke access is the
  analog).
