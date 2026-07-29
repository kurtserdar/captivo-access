# Production deploy

This directory is a **production** deployment scaffold for Captivo Access:
the published `ghcr.io` images, fronted by [Caddy](https://caddyserver.com/)
for automatic HTTPS, with the Manager console and per-site vendor proxy
routed to the right service.

It's separate from the repo-root `docker-compose.yml`, which is the
dev/build stack (it builds images locally). Don't use that one in
production — use this directory instead.

## Architecture recap

- **`access-manager`** (Next.js, `:3100`) — the console: setup, auth,
  invites, admin, APIs. Not published to the host; only Caddy reaches it.
- **`access-dataplane`** (Go) — three listeners:
  - `:3101` — connector WSS. **Published**: connectors running inside
    customer data centers dial *in* to this over the internet.
  - `:3102` — internal API (Manager ↔ data-plane). Never published.
  - `:3103` — the browser-facing identity-aware proxy that serves vendor
    traffic for `<site>.<ACCESS_DOMAIN>`. Not published to the host; only
    Caddy reaches it.
- **`caddy`** — terminates TLS on `:80`/`:443` and reverse-proxies by
  hostname to the two services above, setting `X-Forwarded-Host` /
  `X-Forwarded-Proto` / `X-Forwarded-For` (Caddy does this by default —
  both the Manager and the data-plane's proxy rely on these headers being
  set correctly by the front proxy).
- **`access-postgres`** — not published; only reachable from other
  containers on the compose network.

## Prerequisites

1. A domain you control (e.g. `access.example.com`).
2. DNS records pointing at this host's public IP:
   - `manager.access.example.com` → this host
   - `*.access.example.com` → this host (wildcard — see the
     [TLS note](#wildcard-tls-note) below for what it takes to actually
     get a cert for this)
3. Docker + Docker Compose v2 on the host, ports 80 and 443 reachable from
   the internet.
4. Nothing to build — this stack pulls the published images
   (`ghcr.io/kurtserdar/captivo-access-manager:latest` and
   `...-dataplane:latest`).

## Deploy steps

```bash
cd deploy
cp .env.prod.example .env
# edit .env: fill in ACCESS_DOMAIN and every secret (see the
# `# openssl rand -hex 32` comments in the file for how to generate them)

docker compose -f docker-compose.prod.yml up -d
```

This starts Postgres, the Manager, the data-plane, and Caddy. Caddy will
request certs automatically — the `manager.<ACCESS_DOMAIN>` block works
out of the box via HTTP-01. Watch the logs on first start:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

### First-run: push the database schema

The images don't run migrations automatically. Once `access-postgres` is
healthy, push the Prisma schema once against it:

```bash
docker compose -f docker-compose.prod.yml exec -T access-postgres \
  pg_isready -U access -d captivo_access   # sanity check

# from a machine with the repo checked out and DATABASE_URL pointed at the
# published postgres port — easiest is to run prisma db push from a throwaway
# container on the same compose network:
docker run --rm --network captivo-access-prod_default \
  -e DATABASE_URL="postgresql://access:<POSTGRES_PASSWORD>@access-postgres:5432/captivo_access" \
  -v "$PWD/../prisma:/app/prisma" -w /app \
  node:20-alpine sh -c "corepack enable && npx --yes prisma db push --schema=prisma/schema.prisma"
```

(Substitute the real `POSTGRES_PASSWORD` from your `.env`.) You only need
to do this once per fresh database, and again after pulling a new image
version that changed the schema.

### Open it

Go to `https://manager.<ACCESS_DOMAIN>/setup` and register the first
account as a passkey (becomes `ADMIN`). See the repo root
[README](../README.md#identity--passkey) for the invite/login flow.

## Wildcard TLS note

Automatic HTTPS for a **wildcard** hostname (`*.access.example.com`)
requires the ACME **DNS-01** challenge — plain HTTP-01/TLS-ALPN-01 can't
prove control of a wildcard name. DNS-01 needs a DNS-provider plugin built
into Caddy, and the plain `caddy:2-alpine` image used here ships with
**no DNS plugins**. `deploy/Caddyfile` ships with the wildcard block
commented out for exactly this reason (see the comments in that file).

Pick one:

- **Build a custom Caddy image** with [xcaddy](https://github.com/caddyserver/xcaddy)
  bundling your DNS provider's module, e.g.:
  ```bash
  xcaddy build --with github.com/caddy-dns/cloudflare
  ```
  point the `caddy:` service's `image:` in `docker-compose.prod.yml` at
  your built image, set `DNS_API_TOKEN` in `.env` to that provider's API
  token, and uncomment the `*.{$ACCESS_DOMAIN} { tls { dns ... } ... }`
  block in `Caddyfile`.
- **Skip the wildcard.** Add one explicit host block per vendor site
  instead — each gets its own cert via plain HTTP-01, no DNS plugin
  required:
  ```caddyfile
  acme-corp.{$ACCESS_DOMAIN} {
      reverse_proxy access-dataplane:3103
  }
  ```
  This is more manual (one DNS record + one Caddy block per site) but
  needs nothing beyond the stock `caddy:2-alpine` image.

Until one of these is done, requests to `*.<ACCESS_DOMAIN>` other than
`manager.<ACCESS_DOMAIN>` have no TLS termination — vendor site access
won't work over HTTPS.

## How a vendor reaches an app

Once an admin has created a `Site`, an `AccessGrant`, and the vendor has
registered a passkey, they open `https://<site>.access.example.com` in
their browser. Caddy terminates TLS and forwards to
`access-dataplane:3103`, which checks the session cookie (scoped to
`COOKIE_DOMAIN`, so it's already set from logging in at
`manager.access.example.com`), evaluates the grant, and — if allowed —
streams the request over the outbound tunnel to the connector running
inside the customer's network, which reaches the real internal app.

## Updating

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Re-run the `prisma db push` step above if the new version changed the
schema (check the release notes / CHANGELOG).
