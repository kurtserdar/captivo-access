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

> **Easiest — from the console.** Admin console → **Connectors → Set up gateway**
> gives you a single copy-paste line, `curl -fsSL <manager>/gateway/install.sh | sh`,
> that fetches the compose and runs setup for you on the connector host. The
> manual two-file steps below are the exact equivalent — use them if you'd
> rather inspect the script first, or aren't logged into the console on that host.

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

## 4. Single sign-on (enabled by default)
Gateway Sites auto-log the vendor into Guacamole — no second login. Captivo injects the vendor's **email**
as a trusted header (`X-Captivo-User`); Guacamole's header-auth extension reads it and signs the vendor in
automatically. **This is enabled by default** (`HEADER_ENABLED` / `HTTP_AUTH_HEADER` in
`docker-compose.gateway.yml`). To turn it **off**, comment both lines and recreate the Guacamole container;
vendors then use Guacamole's normal login (one extra login).

- **Trade-off — decide before enabling.** Header-auth SSO **suppresses Guacamole's logout and trims
  in-session navigation** (logout is meaningless when Captivo re-authenticates every request), so a vendor
  tends to get "stuck" in one connection and can't easily switch connections or sign out. It fits **fast,
  single-target** access. If your vendors browse/switch between **multiple** connections, leave SSO **off** —
  Guacamole's normal login gives them the full home/switch/logout UI (the only cost is a second login). You
  can flip it anytime by (un)commenting the two env vars and restarting.
- **Operator step when SSO is on (identity pass-through):** create a Guacamole user for each vendor **email**
  (Settings → Users → New user, username = the vendor's email exactly) and assign their connections. Until
  you do this, the vendor still logs in via the header, but sees an empty connection list.
- **Trust boundary (important):** Guacamole trusts this header absolutely — anyone who can set it is
  whoever they claim to be. Never expose Guacamole's port to anything but the Captivo connector/data-plane;
  it must be reachable **only through Captivo**, which strips any client-supplied `X-Captivo-User` before
  injecting its own. Keep it bound to localhost / the internal `captivo-gateway` network, exactly as this
  pack already sets it up — do not publish port 8080 directly or put another reverse proxy in front of it.
- **After upgrading** this pack (new compose or new `guacamole/guacamole` image), re-pull the gateway
  compose and restart Guacamole so the new compose takes effect:
  ```bash
  curl -fsSLO https://raw.githubusercontent.com/kurtserdar/captivo-access/main/deploy/gateway/docker-compose.gateway.yml
  docker compose -f docker-compose.gateway.yml up -d
  ```

## 5. Create a recorded connection
In the Guacamole UI → Settings → Connections → New connection. Pick **RDP / SSH / VNC**, set the target host
(reachable from guacd over the LAN) + credentials, and under **"Screen Recording"** set:
- **Recording path:** `/var/lib/guacamole/recordings`
- **Recording name:** e.g. `${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}`
- **Automatically create recording path:** enabled

guacd writes the raw recording to the `guac_recordings` volume. (The compose's `guac-record-init` makes that
volume writable by guacd's uid 1000 — the one real gotcha of this stack.)

## 6. Watch recordings
In the Guacamole UI → Settings → **History**, each recorded session has a **play** control that replays the raw
recording in the built-in player — no extra tooling. (To export a standalone `.m4v`, run `guacenc` over the raw
recording file separately; not required just to watch.)

## Notes & caveats
- **Single sign-on:** the vendor logs into Captivo only — Guacamole auto-logs-in via the trusted
  `X-Captivo-User` header. See [Single sign-on](#4-single-sign-on) above for the operator step (per-vendor
  user provisioning) and the trust boundary.
- **Compute:** the host needs headroom for the JVM + guacd + per-session encoding. Opt-in, so acceptable —
  but plan for it.
- **Patching:** you now run Guacamole (guacd/Tomcat) — keep it updated for CVEs.
- **Data residency:** recordings stay in `guac_recordings` on this host; they never transit to Captivo. Back
  them up per your retention policy.
- **Security:** don't expose port 8080 to the internet — reach it only through Captivo (identity/grant/audit).
  Change the `guacadmin` password.

## Credential vault (Pro) — injected sessions

With the vault, a vendor opens a GATEWAY site and lands directly in the RDP/SSH/VNC
session — **no Guacamole login, no password**. The target credential is stored
encrypted in Captivo and injected per session via a signed `guacamole-auth-json`
blob (the official Guacamole image auto-loads that extension when `JSON_SECRET_KEY`
is set).

Setup:

1. `./setup.sh` generates `GUAC_JSON_SECRET_KEY` in `.env` and prints it.
2. On the Captivo manager, set the **same** value as `GUAC_JSON_SECRET_KEY`, and
   set `VAULT_ENABLED=1`.
3. In Captivo → the GATEWAY Site → **Vault credential**, store the target
   protocol/host/port/username/secret. The vendor's **Open** now injects it.

Without a vault credential (or with `VAULT_ENABLED` off), Open falls back to the
plain gateway URL and the vendor logs in manually — nothing breaks.

> **Note (validate at first use):** this gateway pack also ships header-auth SSO
> (the `X-Captivo-User` header). The vault's json-auth path and header-auth are
> both loaded; the injected `data` blob carries the connection + credentials.
> Confirm the injected-session flow end to end against your first real target —
> if the two auth paths interfere, disable header-auth (comment out
> `HTTP_AUTH_HEADER` / `HEADER_ENABLED`) for vault-injected gateways.
