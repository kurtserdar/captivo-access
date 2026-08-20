# Isolated Browser Logs (connector detail) — Design

**Date:** 2026-08-20
**Status:** Approved (design)
**Scope:** Surface the isolated-browser (KasmVNC broker) log tail on the connector
detail page, mirroring the existing "Gateway logs" (guacd) feature.

## Problem

A gateway-flagged connector's detail page shows two log tails — the connector's own
"Recent logs" and "Gateway logs" (guacd, the remote-desktop engine) — but nothing
for the **isolated browser** (kasm-browser / KasmVNC). When an isolated session
misbehaves there is no in-console way to see the engine's side. Two gaps cause this:

1. **No shared log channel.** guacd tees its log to a `captivo_guacd_logs` volume
   that the connector mounts read-only and tails; the `captivo-kasm` container has
   no equivalent log volume/tee.
2. **The broker is nearly silent.** `kasm-browser/control.py` only logs "reaping
   stale session" and silences HTTP request logging (`log_message` → pass). Even if
   we tee its output, the tail would be almost empty.

## Goal

An **"Isolated browser logs"** section on the connector detail page (next to
"Gateway logs"), showing the tail of the KasmVNC broker's session-lifecycle log —
so an operator can troubleshoot isolated sessions from the console. Built as a
mirror of the guacd-logs feature, plus adding the broker logging that makes it
useful.

## Approach

Mirror the guacd-logs data path end-to-end, and give the broker real logs.

### 1. Broker logging (`kasm-browser/control.py`)

The broker is currently near-silent. Add timestamped, `flush=True` log lines for
the session lifecycle — the analog of guacd's connection log:

- session opened: `session <sid> opened → <url> (<w>x<h>)`
- session closed: `session <sid> closed`
- capacity reached: `capacity reached (<MAX_SESSIONS> active) — session refused`
- spawn / recording failures (broker-level errors)

Keep it to lifecycle + errors — **not** per-request HTTP, and **not** the
Xvnc/Chromium/ffmpeg per-session noise. A small helper (e.g. `log(msg)`) prints
`<ISO-ish timestamp> <msg>` to stdout with `flush=True`.

### 2. Tee to a shared volume (`kasm-browser/entrypoint.sh`)

The entrypoint currently ends with `exec python3 /control.py`. Change it to create
the log dir and tee the broker's output to a file on a shared volume:

```
mkdir -p /kasmlog
python3 /control.py 2>&1 | tee /kasmlog/kasm.log
```

(The hub Xvnc stays as-is in the background; only the broker output — the useful
part — is tee'd. `tee` truncates on container restart, which the connector's tail
already handles for guacd.)

### 3. Deploy: shared log volume (`src/lib/connector/repair.ts`)

Add a new named volume `captivo_kasm_logs`, mounted:
- on the `captivo-kasm` container: `-v captivo_kasm_logs:/kasmlog` (read-write; the
  broker writes),
- on the `access-connector` container: `-v captivo_kasm_logs:/kasmlog:ro` (the
  connector tails it).

This mirrors how `captivo_guacd_logs` is mounted on guacd (rw) + the connector
(ro). No chown step is needed — the broker runs as root (writes `/root/.vnc`).

### 4. Connector tail + telemetry (`connector/`)

- **`connector/kasmlog.go`** — a mirror of `guacdlog.go`: a `kasmLogRing`
  (`newLogRing(300)`) and `tailKasmLog(path)` that follows `/kasmlog/kasm.log`,
  handling truncation the same way.
- **`connector/main.go`** — after the guacd tail, if `os.Stat("/kasmlog")`
  succeeds, `go tailKasmLog("/kasmlog/kasm.log")`. Absent on non-gateway hosts →
  the ring stays empty.
- **`connector/stats.go`** — add `KasmLogs: kasmLogRing.tail(80)` to the reported
  `Telemetry`.

### 5. Wire format (`tunnel/controlframe.go`)

Add `KasmLogs []string` to the `Telemetry` struct, alongside `RecentLogs` and
`GuacdLogs`. **The data plane needs no change** — it stores/serves the whole
`*tunnel.Telemetry` on the Session (`registry.go`), so the new field flows to the
manager automatically.

### 6. Manager (`src/lib/connector/telemetry.ts`, connector detail page)

- Add `kasmLogs?: string[]` to the telemetry TypeScript type.
- On `src/app/(app)/admin/connectors/[id]/page.tsx`, add an **"Isolated browser
  logs"** card mirroring the "Gateway logs" card: title + "Last lines from the
  isolated browser engine (KasmVNC)"; render `t.kasmLogs` when present, else a hint
  ("No isolated-browser logs yet — the connector is offline, or hasn't been updated
  to report them (re-run its command).").

## Data flow (end to end)

```
broker (control.py) → stdout → tee → /kasmlog/kasm.log   [captivo-kasm container]
        → shared volume captivo_kasm_logs (ro) →
connector tailKasmLog → kasmLogRing → Telemetry.KasmLogs  [access-connector]
        → control channel → data plane (stores Telemetry) →
manager connector-telemetry → connector detail "Isolated browser logs"
```

## Non-goals

- No dataplane logic change (Telemetry struct passthrough).
- No per-session Xvnc/Chromium/ffmpeg logs (noise); broker lifecycle only.
- No change to guacd logs, recording, or the session relay.
- No log persistence/history — a live tail (last ~80 lines), same as guacd.

## Compatibility & deploy

- **Old connectors / images:** a connector or kasm image not yet updated simply
  reports no `kasmLogs` → the UI shows the hint. No breakage.
- **Requires:** rebuilt `connector` + `kasm-browser` images **and** re-running the
  gateway-host install (repair) command so the new `/kasmlog` volume is mounted on
  both containers. Manager + tunnel also rebuilt. Data plane unchanged.

## Testing

- **Connector (Go):** `tailKasmLog` truncation/append behavior — reuse the
  `guacdlog` test approach if one exists, else a small table test on the ring + a
  tail over a temp file that shrinks.
- **Broker (Python):** the `log()` helper formats a line and the lifecycle points
  call it (assert the broker emits an "opened"/"closed"/"capacity" line for the
  corresponding action — extend `control_test.py` where feasible without a live X
  server; at minimum unit-test the `log()` formatter).
- **Build:** `go build`/`go test` (connector, tunnel), broker byte-compile + test,
  `pnpm build` (manager).
- **Manual (post-deploy + gateway re-run):** open an isolated session, then the
  connector detail page → "Isolated browser logs" shows the opened/closed lines;
  confirm a non-gateway connector shows the hint.

## Release

Deploy + release notes are separate standing gates — do NOT auto-run. This spans
connector + kasm-browser (connector-side) and tunnel + manager (central). On tag,
add an English user-focused `gh release edit` note; note the gateway-host install
must be re-run.
