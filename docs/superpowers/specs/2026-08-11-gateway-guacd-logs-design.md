# Gateway diagnostics — guacd logs on the connector detail page

**Status:** approved design (2026-08-11)
**Repo:** `/opt/captivo-access` (public OSS, English-only)
**Related:** GW-B (bundled guacd), GW-C1/C2 (native recording + live view)

## Goal

Show a gateway-host connector's **guacd** logs on the connector detail page
(`/admin/connectors/[id]`), right beside the connector's own "Recent logs", so
operators can troubleshoot remote-desktop sessions (RDP/SSH/VNC auth failures,
unreachable targets, TLS/NLA errors) from the console instead of SSHing to the
host to run `docker logs captivo-guacd`.

## Core approach: shared log volume (no docker socket)

guacd runs as a **separate container** (`captivo-guacd`) on gateway-host
connectors; the connector process does not own its logs. Rather than grant the
connector the Docker socket (host root — unacceptable in a zero-trust product),
guacd writes its stderr to a file on a **shared volume** that the connector also
mounts read-only and tails. The connector ships the tail in its existing
telemetry, and the manager renders it. guacd's log level stays fixed at `info`
(the image default) — enough to surface connection/auth events; a per-connector
level is intentionally out of scope.

## Architecture

```
captivo-guacd ──stderr──► tee ──► docker logs captivo-guacd (unchanged)
                            └────► /guaclog/guacd.log  (captivo_guacd_logs volume)
                                        │  (same volume, mounted :ro)
access-connector ──tail──► guacdLogRing(300) ──► Telemetry.GuacdLogs (tail 80)
                                        │  control stream
data-plane (holds latest telemetry) ──► GET /internal/… connector-telemetry
                                        │
manager /admin/connectors/[id] ──► "Gateway logs" card
```

## Components

### 1. guacd command — capture stderr to the shared volume (`src/lib/connector/repair.ts`)

The bundled gateway-host command already runs `guacamole/guacd:1.5.5`. Change the
guacd `docker run` so it (a) mounts a new `captivo_guacd_logs` volume and (b)
overrides the image CMD to also write stderr to a file via `tee`:

```
docker run -d --name captivo-guacd --restart unless-stopped --network captivo-gateway \
  -v captivo_guacd_recordings:/recordings \
  -v captivo_guacd_logs:/guaclog \
  guacamole/guacd:1.5.5 \
  /bin/sh -c '/opt/guacamole/sbin/guacd -b 0.0.0.0 -L $GUACD_LOG_LEVEL -f 2>&1 | tee /guaclog/guacd.log'
```

- The override replicates the image's own CMD (`guacd -b 0.0.0.0 -L $GUACD_LOG_LEVEL -f`)
  and appends `2>&1 | tee /guaclog/guacd.log`. `$GUACD_LOG_LEVEL` comes from the
  image's default env (`info`) — no `-e` needed.
- `tee` (not `tee -a`) **truncates** the file at container start, so it resets on
  every guacd restart — bounding growth to a single guacd uptime. `docker logs
  captivo-guacd` keeps working (stderr still goes to stdout via `2>&1`).

The **connector** `docker run` (gateway-host branch only) gains a read-only mount
of the same volume so it can tail the file:

```
docker run -d --name access-connector ... --network captivo-gateway \
  -v access_connector_data:/data \
  -v captivo_guacd_logs:/guaclog:ro \
  ghcr.io/kurtserdar/captivo-access-connector:latest
```

Both the guacd and connector changes are in the `gatewayHost` branch of
`runCommand`; non-gateway connector commands are unchanged.

### 2. Connector guacd-log tail (`connector/guacdlog.go`, new)

A goroutine tails `/guaclog/guacd.log` into a dedicated ring, reusing the
existing `logRing` type:

- `var guacdLogRing = newLogRing(300)`
- `func tailGuacdLog(path string)` — poll loop (~2 s):
  - `stat` the file; if it doesn't exist yet, wait and retry (non-gateway hosts
    never mount `/guaclog`, so the tail is simply never started — see below).
  - Track a byte offset. If the file size is **smaller** than the offset, guacd
    restarted and `tee` truncated the file → reset the offset to 0.
  - Read bytes from the offset to EOF, split into complete lines (buffer a
    trailing partial line for the next tick), and `guacdLogRing.Write` each line.
- Started from `connector/main.go` **only if `/guaclog` exists** at startup
  (i.e. the volume is mounted → this is a gateway host). Otherwise not started,
  and `guacdLogRing` stays empty.
- The line-splitting + truncation logic is factored into a pure helper so it can
  be unit-tested without real files.

### 3. Telemetry (`tunnel/controlframe.go` + `connector/stats.go`)

- Add `GuacdLogs []string \`json:"guacdLogs"\`` to `Telemetry` (beside `RecentLogs`).
- `snapshot()` sets `GuacdLogs: guacdLogRing.tail(80)` (empty on non-gateway hosts).
- The data-plane already forwards the whole `Telemetry` via the
  connector-telemetry internal endpoint; the new field rides along with no
  data-plane logic change (it only needs a rebuild against the updated struct).

### 4. Manager — "Gateway logs" card (`src/app/(app)/admin/connectors/[id]/page.tsx`)

Add a second terminal card immediately after the existing "Recent logs" card,
shown **only for gateway-host connectors** (`connector.gatewayHost`):

- Title "Gateway logs", subtitle "Last lines from guacd (remote-desktop engine)".
- Renders `t.guacdLogs` the same way "Recent logs" renders `t.recentLogs`
  (reusing `logLineClass` for severity coloring).
- Empty state: "No guacd logs yet — the connector is offline, or hasn't been
  updated to report gateway logs (re-run its command)."

## Data flow

1. guacd logs to stderr → `tee` writes each line to `/guaclog/guacd.log`.
2. The connector's tail goroutine reads new lines into `guacdLogRing`.
3. The connector's periodic telemetry includes `guacdLogs` (tail 80).
4. The data-plane holds the latest telemetry; the manager detail page fetches it
   and renders the "Gateway logs" card.

## Error handling / edge cases

- **Non-gateway connector:** `/guaclog` isn't mounted → tail never starts →
  `guacdLogs` empty → the card isn't shown (gated on `gatewayHost`).
- **File missing / guacd not started yet:** tail retries; ring stays empty.
- **guacd restart:** `tee` truncates the file; the tail detects size < offset and
  resets to 0 (no stale/duplicated lines).
- **File growth:** bounded per guacd uptime by truncate-on-restart; `info` level
  is light. No active rotation (out of scope, accepted).
- **Existing gateway hosts:** must re-run the gateway-host connector command once
  to pick up the new guacd command (tee + log volume) and the connector's
  `/guaclog` mount. Until then, `guacdLogs` stays empty and the card shows its
  empty state.

## Non-goals

- Adjustable guacd log level (fixed `info`).
- Live streaming / full-history guacd logs (only the last ~80 lines, like the
  connector's own tail).
- Docker-socket access of any kind.
- Log rotation beyond truncate-on-restart.

## Capability gating / config

- No new capability env. No schema change (nothing in `prisma/schema.prisma`) →
  **no `access-migrate` run** on deploy.
- New Docker volume `captivo_guacd_logs` (created implicitly by the connector
  command's `-v`).

## Testing

**Go (`go test ./...`):**
- Connector tail helper: given a byte offset + a new chunk, returns complete
  lines and buffers a trailing partial; a smaller-than-offset size resets to 0.
- `guacdLogRing` reuses `logRing` (already covered) — no new ring test needed.

**TS (vitest, `src/lib/connector/repair.test.ts`):**
- The gateway-host install/update/re-pair commands include `captivo_guacd_logs`,
  `tee /guaclog/guacd.log`, and the connector's `-v captivo_guacd_logs:/guaclog:ro`.
- Non-gateway commands include none of the above.

**Gate A (live, operator):**
- On a gateway-host connector running an RDP session, `/admin/connectors/[id]`
  shows a "Gateway logs" card with guacd's connection lines. Trigger a failure
  (e.g. wrong target) → the guacd error appears in the card.
- A non-gateway connector shows no "Gateway logs" card.

## Deploy notes

- Rebuild + bump **connector** (tail), **data-plane** (Telemetry struct), and
  **manager** (guacd command + detail card). No migrate.
- Operators **re-run the gateway-host connector command** once so guacd starts
  with `tee`/the log volume and the connector mounts `/guaclog`.
- English-only strings + GitHub Release note.

## File map

**Create:** `connector/guacdlog.go` (+ `guacdlog_test.go`).
**Modify:** `src/lib/connector/repair.ts` (guacd `tee` + volumes; connector
`/guaclog` mount) + `repair.test.ts`; `tunnel/controlframe.go` (`GuacdLogs`);
`connector/stats.go` (populate `GuacdLogs`); `connector/main.go` (start the tail
if `/guaclog` exists); `src/app/(app)/admin/connectors/[id]/page.tsx` ("Gateway
logs" card).
