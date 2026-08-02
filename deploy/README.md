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
- **`access-dataplane`** (Go) — three listeners, **none published to the
  host**; Caddy terminates TLS and reverse-proxies to each by service name:
  - `:3101` — connector WSS. The data-plane serves this as **plain HTTP**
    (no TLS of its own), so Caddy fronts it at `connect.<ACCESS_DOMAIN>` and
    connectors dial *in* over `wss://connect.<ACCESS_DOMAIN>`. Publishing 3101
    raw would carry the tunnel unencrypted over the internet — don't.
  - `:3102` — internal API (Manager ↔ data-plane). Never exposed off-network.
  - `:3103` — the browser-facing identity-aware proxy that serves vendor
    traffic for `<site>.<ACCESS_DOMAIN>`, fronted by Caddy.
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
   - `manager.access.example.com` → this host (Manager console)
   - `connect.access.example.com` → this host (connector tunnel — gets its
     own cert automatically via HTTP-01, no plugin needed)
   - `*.access.example.com` → this host (per-site vendor access — wildcard;
     see [Wildcard TLS: the manageable path](#wildcard-tls-the-manageable-path) below for what it takes to
     actually get a cert for this)
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

## Wildcard TLS: the manageable path

Each internal app you publish is a `Site` with its own public hostname
(`jira.access.example.com`, `cyberark.access.example.com`, …). You want
adding an app to be a **one-line change in the Manager UI** — not a new DNS
record and a new cert every time. That means a **single wildcard**
`*.access.example.com` covering every current and future site.

A wildcard cert requires the ACME **DNS-01** challenge (plain
HTTP-01/TLS-ALPN-01 can't prove control of a wildcard name), and DNS-01
requires programmatic access to your DNS zone via an API. This is the whole
game — get DNS-01 working once and every future app costs zero TLS/DNS work.

### The real blocker is your DNS provider's API, not Caddy

DNS-01 needs your DNS host's API — and **many registrars gate or disable it.
GoDaddy, for example, cut off DNS API access in 2024 for accounts with fewer
than 10 domains** ([Let's Encrypt community
thread](https://community.letsencrypt.org/t/godaddy-no-longer-allows-api-access-to-clients-e-g-for-dns-based-cert-renewal-if-you-have-less-than-50-domains/219377)),
so the GoDaddy path simply won't work for most users. Switching ACME tools
(certbot, acme.sh, Caddy) doesn't help — they all need that same API.

### Recommended: host the DNS zone somewhere with a real API

**Your registrar and your DNS host don't have to be the same company.** Keep
your domain registered wherever it is (GoDaddy, Namecheap, …) and move the DNS
that DNS-01 needs to a host with a free, first-class API. Two clean paths,
depending on whether you're willing to move the whole domain's DNS — **both
avoid the registrar's (possibly locked-down) API entirely:**

**Path A — Cloudflare, whole zone.** Best if the domain is dedicated to this
deployment, or you're happy hosting all of its DNS on Cloudflare. Note the
Cloudflare **free plan only supports a full zone** (moving the entire domain),
not delegating a lone subdomain — subdomain-only zones are an Enterprise
feature.

1. [Cloudflare](https://www.cloudflare.com/) → **Add a site** → `example.com`
   (Free). Recreate your existing records first (MX/mail, current web records)
   so nothing breaks when nameservers move.
2. At your registrar, change the domain's nameservers to the two Cloudflare
   gave you.
3. In Cloudflare DNS, add `manager`, `connect`, and `*` as `A` records to the
   cloud host's IP — **with the orange proxy cloud OFF ("DNS only") on all of
   them.** A proxied (orange) record makes Cloudflare terminate TLS at its
   edge, which collides with Caddy's own TLS and the connector's WSS tunnel.
   You want DNS + API from Cloudflare, not its proxy. (DNS-01 works either way
   — it only writes a TXT record.)
4. Create a scoped API token: **My Profile → API Tokens → Create Token → "Edit
   zone DNS" → Zone = example.com.** Put it in `.env` as `DNS_API_TOKEN`.

**Path B — deSEC (or similar), subdomain only.** Best if you must keep the
domain's DNS at your registrar and delegate just `access.example.com`.

1. [deSEC](https://desec.io/) (free) → **Create domain** → `access.example.com`.
   It gives you its nameservers (e.g. `ns1.desec.io`, `ns2.desec.org`).
2. At your registrar, in the `example.com` zone, add **only** the delegation
   `NS` records (nothing else changes, and you never touch the registrar's
   DNS API):
   ```
   access   NS   ns1.desec.io
   access   NS   ns2.desec.org
   ```
3. In deSEC, add `manager`, `connect`, and `*` `A` records for
   `access.example.com` → the cloud host's IP.
4. Create a token in deSEC's **Token management** and put it in `.env` as
   `DNS_API_TOKEN`.

**Then, for either path**, Caddy needs a build that includes your provider's
DNS module (the stock `caddy:2-alpine` has none). The repo ships this as an
opt-in — `deploy/Caddy.dns.Dockerfile` (a small xcaddy build, provider set by
the `CADDY_DNS_MODULE` build arg, default Cloudflare) plus
`deploy/docker-compose.dns.override.yml` that wires it in without touching the
base stack. So:

1. Set `DNS_API_TOKEN` in `.env` (and, for a non-Cloudflare provider,
   `CADDY_DNS_MODULE=github.com/caddy-dns/<provider>`).
2. Uncomment the `*.{$ACCESS_DOMAIN}` block in `Caddyfile` (it defaults to the
   Cloudflare directive; for deSEC use `dns desec {$DNS_API_TOKEN}`).
3. Bring the stack up with both compose files — the override builds the custom
   Caddy image automatically:
   ```bash
   docker compose -f docker-compose.prod.yml \
     -f docker-compose.dns.override.yml up -d
   docker compose -f docker-compose.prod.yml \
     -f docker-compose.dns.override.yml logs -f caddy   # watch the DNS-01 cert
   ```

Caddy issues the `*.access.example.com` cert via DNS-01. From here,
**publishing a new app is just a `Site` in the Manager UI** — the wildcard
already covers it. (Prefer raw `xcaddy build --with …` and your own image?
That still works — just point the `caddy:` service's `image:` at it instead of
using the override.)

### Already on a provider with a good API?

If your DNS is already hosted somewhere with an open API (Route 53,
DigitalOcean, Hetzner, deSEC, Cloudflare, …), skip the delegation — just pick
your module from the [`caddy-dns`](https://github.com/caddy-dns) org and
`xcaddy build --with` it, same as above.

### Fallback: per-site HTTP-01 (does not scale)

If you truly can't do DNS-01, add one explicit host block per vendor site —
each gets its own cert via plain HTTP-01, no DNS plugin, stock
`caddy:2-alpine`:

```caddyfile
acme-corp.{$ACCESS_DOMAIN} {
    reverse_proxy access-dataplane:3103
}
```

But this costs **one DNS record + one Caddy block + one reload per app** —
fine for a handful, unmanageable past that. Prefer the wildcard.

Until one of these is in place, requests to `*.<ACCESS_DOMAIN>` other than
`manager.` and `connect.` have no TLS termination — vendor site access won't
work over HTTPS.

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
