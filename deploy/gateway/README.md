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

## 1. Deploy the gateway
On the connector host, in `captivo-access/deploy/gateway/`:

```bash
# a. Generate the Guacamole DB schema ONCE (version-matched to the image).
mkdir -p initdb
docker run --rm guacamole/guacamole:1.5.5 \
  /opt/guacamole/bin/initdb.sh --postgresql > initdb/01-schema.sql

# b. Set the DB password.
cp .env.gateway.example .env
# edit .env → GUAC_DB_PASSWORD=$(openssl rand -hex 32)

# c. Bring it up.
docker compose -f docker-compose.gateway.yml up -d
```

The Guacamole web UI is now at `http://<connector-host>:8080/guacamole/` (bound to localhost by default —
change the port mapping if the connector reaches it by another address). First login is `guacadmin` /
`guacadmin` — **change this password immediately** (top-right menu → Settings → Preferences), it is the
gateway's admin.

## 2. Publish it as a Captivo Site
In the Captivo console → **Sites → Add site**:
- **Internal address:** `http://<connector-host>:8080/guacamole/` (the address guacd/guacamole is reachable at
  from the connector — often `http://cap-guacamole:8080/guacamole/` if you attach the connector to this compose
  network, or the host IP:8080).
- Give it a hostname (e.g. `console.access.example.com`) and the connector that runs the gateway.

Now a vendor with a Captivo grant reaches Guacamole through Captivo — passkey login, time-boxed/approved
access, and every request in the Captivo audit log. (WebSocket passthrough — which Guacamole's tunnel needs —
is already supported by the Captivo proxy.)

## 3. Create a recorded connection
In the Guacamole UI → Settings → Connections → New connection. Pick **RDP / SSH / VNC**, set the target host
(reachable from guacd over the LAN) + credentials, and under **"Screen Recording"** set:
- **Recording path:** `/var/lib/guacamole/recordings`
- **Recording name:** e.g. `${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}`
- **Automatically create recording path:** enabled

guacd writes the raw recording to the `guac_recordings` volume. (The compose's `guac-record-init` makes that
volume writable by guacd's uid 1000 — the one real gotcha of this stack.)

## 4. Watch recordings
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
