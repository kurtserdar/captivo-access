# Captivo Access — Pro Session Gateway (Apache Guacamole)

**Optional, opt-in.** Adds **isolated + recorded RDP / SSH / VNC** sessions to Captivo Access. The heavy
rendering is done by [Apache Guacamole](https://guacamole.apache.org/) — we don't build or operate it; we
publish it as an ordinary Captivo **Site** so it reuses Captivo's passkey identity, time-boxed grants, and
audit trail. Guacamole records each session **natively**, and because it runs on the customer's own network,
**the recording never leaves that network** — a KVKK/5651 advantage.

The default Captivo deployment stays **connector-only**. This gateway is separate weight you turn on
deliberately, and it needs real compute (JVM + guacd + per-session video encoding) — size the host accordingly.

> Web-app (DOM) session recording is a separate, built-in Captivo feature (rrweb) — see the console's Sites →
> "Record sessions" toggle. This gateway is for **console protocols** (RDP/SSH/VNC) that a DOM recorder can't
> capture.

## Where it runs
On the **same on-prem host as the connector**. `guacd` reaches the RDP/SSH/VNC targets over the local LAN, so
the connector tunnel keeps carrying only HTTP + WebSocket (which it already does) — there is no "tunnel raw
TCP" problem. The Guacamole web UI is just another internal web app that you publish through Captivo.

## 1. Get the pack + deploy — one command
You don't need the whole repo — the gateway is self-contained. On the connector host, grab **two files**:

```bash
mkdir gateway && cd gateway
base=https://raw.githubusercontent.com/kurtserdar/captivo-access/main/deploy/gateway
curl -fsSLO "$base/docker-compose.gateway.yml"
curl -fsSLO "$base/setup.sh" && chmod +x setup.sh
```
(Or `git clone` the repo and `cd deploy/gateway` if you already have it.)

Then pick one mode:

**Gateway only** — you'll pair/attach the connector separately:
```bash
./setup.sh
```

**All-in-one gateway host** — also pair + run the connector on the gateway network in one go. Copy
`MANAGER_URL`, `DATAPLANE_URL`, and the pairing code from the console's **Add connector**:
```bash
MANAGER_URL=https://manager.access.<domain> \
DATAPLANE_URL=wss://connect.access.<domain> \
./setup.sh <PAIR_CODE>
```

`setup.sh` generates the Guacamole schema, writes a random DB password to `.env`, creates the shared
`captivo-gateway` network if it doesn't exist yet, brings the stack up, and prints the next steps — including how
to join an existing connector to the gateway network durably (see below). Idempotent — safe to re-run.

The Guacamole web UI is then at `http://127.0.0.1:8080/` (served at the root path via `WEBAPP_CONTEXT: ROOT`, so
it publishes cleanly as a Site; bound to localhost). First login is `guacadmin` / `guacadmin` — **change this
password immediately** (top-right → Settings → Preferences); it's the gateway's admin.

> **Port 8080 already in use on this host?** Put `GUAC_PORT=9000` (any free port) in `.env` and re-run
> `./setup.sh`. That only changes your local admin port — the connector still reaches Guacamole by container
> name over the gateway network, so nothing else changes.

## 2. Join the connector to the gateway network
For the connector to reach `cap-guacamole` by name, it needs to be on the shared `captivo-gateway` network
(created for you by `setup.sh`). Do this **in the console**, not with a manual `docker network connect` — that
attach doesn't survive a connector recreate, so it silently breaks on the next update:

1. Console → **/admin/connectors** → find the connector running on this host → **Enable gateway mode**.
2. Run the update command it shows you, once.

That bakes `--network captivo-gateway` into the connector's own `docker run`, so it rejoins the network every
time the container is recreated — including future connector updates — with no further action needed.

## 3. Publish it as a Captivo Site
In the Captivo console → **Sites → Add site**:
- **Internal address:** `http://cap-guacamole:8080` — no path (the app is at the root, and `cap-guacamole`
  resolves over the shared gateway network once the connector has joined it as above; use `http://<host-ip>:8080`
  if the connector reaches it by host address instead).
- Give it a hostname (e.g. `console.access.example.com`) and the connector that runs the gateway.

Now a vendor with a Captivo grant reaches Guacamole through Captivo — passkey login, time-boxed/approved
access, and every request in the Captivo audit log. (WebSocket passthrough — which Guacamole's tunnel needs —
is already supported by the Captivo proxy.)

## 4. Create a recorded connection
In the Guacamole UI → Settings → Connections → New connection. Pick **RDP / SSH / VNC**, set the target host
(reachable from guacd over the LAN) + credentials, and under **"Screen Recording"** set:
- **Recording path:** `/var/lib/guacamole/recordings`
- **Recording name:** e.g. `${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}`
- **Automatically create recording path:** enabled

guacd writes the raw recording to the `guac_recordings` volume. (The compose's `guac-record-init` makes that
volume writable by guacd's uid 1000 — the one real gotcha of this stack.)

## 5. Watch recordings
In the Guacamole UI → Settings → **History**, each recorded session has a **play** control that replays the raw
recording in the built-in player — no extra tooling. (To export a standalone `.m4v`, run `guacenc` over the raw
recording file separately; not required just to watch.)

## Notes & caveats
- **Double login (for now):** the vendor logs into Captivo, then into Guacamole. A later iteration can wire
  Guacamole **header-auth** so Captivo passes an authenticated header and Guacamole auto-logs-in (no second
  password). Deferred.
- **Compute:** the host needs headroom for the JVM + guacd + per-session encoding. Opt-in, so acceptable —
  but plan for it.
- **Patching:** you now run Guacamole (guacd/Tomcat) — keep it updated for CVEs.
- **Data residency:** recordings stay in `guac_recordings` on this host; they never transit to Captivo. Back
  them up per your retention policy.
- **Security:** don't expose port 8080 to the internet — reach it only through Captivo (identity/grant/audit).
  Change the `guacadmin` password.
