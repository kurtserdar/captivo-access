# Quickstart — see it work in ~5 minutes (zero DNS)

This is the fastest way to watch a real end-to-end flow — a browser reaching an
internal app through Captivo Access with real HTTPS — **without configuring any
DNS**. It's for evaluation; for a real deployment see
[`deploy/README.md`](../deploy/README.md).

The trick: [**sslip.io**](https://sslip.io/) is a public wildcard DNS service
that resolves `anything.<your-ip>.sslip.io` to `<your-ip>` automatically. So you
get real, publicly-resolvable hostnames — and therefore real Let's Encrypt
certificates — with no DNS records to create.

## What you need

- A server with a **public IP**, **ports 80 and 443 open** to the internet, and
  Docker + Docker Compose v2. (A cheap throwaway VPS is perfect. Don't reuse a
  box that already serves a site or mail on 80/443.)
- 5 minutes.

Throughout, replace `SERVER_IP` with your server's public IP written with dots,
e.g. `203.0.113.10`.

## 1. Get the repo and configure

```bash
git clone https://github.com/kurtserdar/captivo-access.git
cd captivo-access/deploy
cp .env.prod.example .env
```

Edit `.env` — set the domain to your sslip.io name and generate the secrets:

```bash
ACCESS_DOMAIN=SERVER_IP.sslip.io
COOKIE_DOMAIN=.SERVER_IP.sslip.io
MANAGER_PUBLIC_URL=https://manager.SERVER_IP.sslip.io
WEBAUTHN_RP_ID=SERVER_IP.sslip.io
# then fill POSTGRES_PASSWORD / SESSION_SECRET / ENCRYPTION_KEY /
# DATAPLANE_SECRET / CRON_SECRET — each: openssl rand -hex 32
```

## 2. TLS is automatic — no Caddyfile edit

The shipped `Caddyfile` already serves `manager.` and `connect.`, **and** a
wildcard `*.{$ACCESS_DOMAIN}` block (On-Demand TLS, gated by the Manager) that
covers every per-site vendor hostname automatically. Any app hostname you add
later — e.g. `app.SERVER_IP.sslip.io` — falls under that wildcard, so there's
nothing to edit here: you just pick the hostname when you create the Site (step
6). Move on.

## 3. Bring it up

```bash
docker compose -f docker-compose.prod.yml up -d
```

The schema is pushed automatically by the one-shot `access-migrate` service on
`up -d` — nothing to run by hand.

Watch the certs get issued: `docker compose -f docker-compose.prod.yml logs -f caddy`.

## 4. Run a dummy "internal app"

Any web app works. This one just echoes request info:

```bash
docker run -d --name testapp --network captivo-access-prod_default nginxdemos/hello
```

The connector will reach it at `http://testapp:80` on the compose network.

## 5. First admin

Open `https://manager.SERVER_IP.sslip.io/setup` and register with a passkey
(this account becomes ADMIN). On Windows, pick **Windows Hello** in the passkey
dialog — if it only offers a USB security key, set up a Windows Hello PIN first
(Settings → Accounts → Sign-in options → PIN).

## 6. Define the app and enroll a connector

In the console:

1. **Connectors → add one.** Copy the generated `docker run` command. For this
   single-box quickstart, run the connector on the compose network and point it
   at the internal service names (simpler and more reliable than the public
   endpoints for an all-in-one-box test):

   ```bash
   docker run -d --name access-connector --restart unless-stopped \
     --network captivo-access-prod_default \
     -e MANAGER_URL=http://access-manager:3100 \
     -e DATAPLANE_URL=ws://access-dataplane:3101 \
     -e PAIR_CODE=<paste from the console> \
     -v access_connector_data:/data \
     ghcr.io/kurtserdar/captivo-access-connector:latest
   ```

   It should show as **online** in the console shortly. No per-app config is
   needed here — the connector takes no `UPSTREAMS` (only an optional
   `ALLOWED_TARGETS` boundary, unneeded for this quickstart).

2. **Sites → add one.** Name it, set **hostname** = `app.SERVER_IP.sslip.io`,
   **internal address** = `http://testapp:80` (the dummy app's address on the
   compose network), and bind it to your connector.

3. **Grants → grant yourself access** to that site (or invite a second user and
   grant them).

## 7. See it work

Open `https://app.SERVER_IP.sslip.io`. You sign in with your passkey, the access
decision is checked, and the request is tunnelled out to the connector and into
the dummy app — you see its response. Revoke the grant and reload: **403**.

That's the whole product, running with real TLS and zero DNS setup. When you're
ready for a real deployment (your own domain, wildcard so new apps are UI-only),
follow [`deploy/README.md`](../deploy/README.md).

## Cleanup

```bash
docker rm -f access-connector testapp
docker compose -f docker-compose.prod.yml down -v
```
