# Captivo Access

**Open-source, self-hosted Zero-Trust / VPNless secure remote access for third-party vendors and contractors.**

> ⚠️ **Status: early development (Slices 0–5 shipped).** Identity & Passkey
> auth, an outbound-only Go connector tunnel, a time-boxed user→site access
> model, an identity-aware reverse proxy, and an append-only audit trail (with
> retention cleanup) are all working. Session isolation/recording, credential
> vaulting, and tamper-evidence (hash-chain / trusted timestamping) on the
> audit log are still **future work**.
> **Not production-ready.** Do not deploy this for real vendor access today —
> track the roadmap below.

## What it is

Captivo Access lets you grant external vendors and contractors time-boxed,
identity-aware access to specific internal applications — without a VPN,
without exposing inbound ports, and without handing out standing credentials.
It's a self-hosted alternative in the spirit of CyberArk Alero / Remote
Access, aimed at vendor-heavy organizations, with Turkish-market data
residency and KVKK/5651 compliance in mind.

We don't run a SaaS for this — **you host it.**

## Architecture

Three components:

```
Vendor browser ──HTTPS+Passkey──▶ MANAGER (customer cloud/DMZ) ◀──outbound tunnel── CONNECTOR (customer DC) ──▶ internal web app
```

- **Manager** — internet-reachable (cloud VPS / DMZ). Handles identity &
  WebAuthn, access policy, the identity-aware proxy edge, and session
  auditing. This repo.
- **Connector** — runs deep inside the customer's network, makes **only
  outbound** connections, and opens no inbound ports. Bridges the Manager to
  internal applications. (Planned — Slice 2, written in Go.)
- **Vendor** — the external user, authenticating with a passkey/biometric,
  granted a time-boxed role over the Manager's proxy.

## Roadmap

| Slice | Delivers |
|---|---|
| **0 (this repo)** | Repo, app skeleton, Postgres/Prisma, Docker self-host packaging, license/security policy/README, CI |
| **1 (this repo)** | Identity + Passkey — admin & vendor users, WebAuthn register/login, TOTP fallback, sessions |
| 2 | Connector tunnel — Go connector (outbound-only), Manager↔Connector protocol |
| 3 | Access model — `AccessGrant` (role + time window + approval-dormant), admin UI |
| 4 | Identity-aware proxy — route an authorized vendor through the connector to the internal app |
| **5 (this repo)** | Audit trail + retention — append-only `AuditEvent` log (who/when/what app/status), admin UI + CSV export, `AUDIT_RETENTION_DAYS` cron cleanup for KVKK/5651. Tamper-evidence (hash-chain / trusted timestamping) is not yet included. |

## Self-host quickstart

Requires Docker + Docker Compose.

```bash
git clone https://github.com/kurtserdar/captivo-access.git
cd captivo-access
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD and SESSION_SECRET (openssl rand -hex 32)
docker compose up -d
```

Then open **http://localhost:3100**.

The Manager is meant to run on an internet-reachable host (cloud VPS / DMZ)
in real deployments. For a production deploy — published images, a Caddy
front proxy with automatic HTTPS, and the manager/wildcard subdomain routing
below wired up for you — see [`deploy/`](deploy/README.md).

## Identity & Passkey

Captivo Access has no default/seed account — the first person to open the
Manager sets it up.

- **First run — `/setup`**: open the Manager, go to `/setup`, and register
  the first account as a passkey. It's created with the `ADMIN` role. A
  race guard prevents two concurrent visitors from both completing setup;
  once an admin exists, `/setup` locks itself for good.
- **Inviting vendors**: an admin generates a one-time invite link at
  `/admin/invites` (email + role + expiry, default `INVITE_TTL_HOURS=48`).
  The vendor opens the link at `/invite/[token]` and registers their own
  passkey — no shared credentials ever exist.
- **Login**: `/login` uses discoverable (resident) passkeys — no username
  field, the authenticator itself picks the credential.
- **Recovery**: if a user loses every passkey, `/recover` accepts their
  email + a TOTP code (set up ahead of time under account settings) and, on
  success, lets them register a brand-new passkey. The response never
  reveals whether the email exists, whether TOTP is configured, or which
  check failed — all failure paths return the same generic error to avoid
  user enumeration.

### ⚠️ Critical: `WEBAUTHN_RP_ID` must match your real domain

WebAuthn passkeys are bound to the *Relying Party ID* (RP ID) at
registration time and checked again on every login. **`WEBAUTHN_RP_ID` must
be set to the exact domain the Manager is served from** (no scheme, no
port):

- Local development: `WEBAUTHN_RP_ID=localhost`
- Production: `WEBAUTHN_RP_ID=access.firma.com` (your Manager's real host)

If this value doesn't match the browser's address bar, passkey registration
and login **fail silently** — the authenticator won't offer or accept the
credential, and there is no meaningful client-side error to debug from. Set
it correctly *before* anyone registers a passkey: changing `WEBAUTHN_RP_ID`
later invalidates every passkey already enrolled against the old value. In
production the origin also **must be HTTPS** — browsers refuse WebAuthn
over plain HTTP for any RP ID other than `localhost`.

### Generating secrets

`SESSION_SECRET` and `ENCRYPTION_KEY` (the latter encrypts TOTP secrets at
rest, AES-256-GCM) are both 32-byte hex secrets:

```bash
openssl rand -hex 32
```

Generate a separate value for each — never reuse one secret for both, and
never commit real values to `.env`.

## Connector tunnel

The Manager (this Next.js app) never dials into the customer network
directly. Instead, a small Go **connector** binary runs inside the customer's
own network and makes an **outbound-only** WebSocket (WSS) connection to a
Go **data-plane** service that sits alongside the Manager; the two ends
multiplex that single connection with [yamux](https://github.com/hashicorp/yamux)
so the Manager can open independent request/response streams over it without
the connector ever accepting an inbound connection or opening a firewall
port. This is the "Slice 2" piece of the architecture described above — it
proves that a connector can enroll, stay connected, and relay a single
proxied request end-to-end. It does **not** yet include the browser-facing
identity-aware proxy or any per-user access gating — those land in a later
slice (see Roadmap); today the only consumer of the tunnel is an admin
"test connection" action.

**Adding a connector**, as an admin:

1. Go to `/admin/connectors` and create a connector by name. The Manager
   generates a one-time pairing code and a ready-to-copy `docker run`
   command.
2. Run that command on a host inside the customer's network, filling in
   `DATAPLANE_URL` (the data-plane's public WSS address) and `UPSTREAMS` (a
   comma-separated `name=http://host:port` list of the internal services
   this connector is allowed to reach). See [`connector/README.md`](./connector/README.md)
   for the full environment variable reference.
3. On first start, the connector redeems the pairing code, stores a
   long-lived token in its `/data` volume, and dials the data-plane. It
   shows up as online at `/admin/connectors`.
4. Under `/admin/sites`, create a Site that references a connector and one
   of its upstream **names** (not a host:port) to test connectivity to that
   internal service.

### Security: the connector's local allowlist

The Manager and data-plane never know — and never send — an internal
`host:port`. A connector's `UPSTREAMS` env var is a **local-only** allowlist
of `name=url` pairs that lives solely inside the customer's own container;
the Manager references upstreams purely by their name (e.g. `wiki`), and the
connector resolves that name against its own allowlist before dialing
anything. A name the connector doesn't recognize is rejected and the stream
is closed — the connector fails closed. This means the real internal
address of a customer's service is never transmitted to, stored on, or
visible from the Manager: it never leaves the customer's network.

## Access grants

An **access grant** ties one vendor user to one site with a time window: an
optional start (empty = immediately) and an optional end (empty =
permanent). It's how an admin decides *which* vendor may reach *which*
internal application, and *when*.

- **Admins create and revoke grants** at `/admin/grants` — pick a user, a
  site, and an optional start/end date, then save. Revoking a grant is
  immediate and irreversible (a new grant can always be created later).
- **Vendors see their own grants** at `/access` ("My access"), grouped into
  **Active** (usable right now) and **Upcoming** (window hasn't started
  yet). Expired and revoked grants drop off this list.
- **Approval is a documented but dormant capability.** The data model has
  `requiresApproval` / `approvedAt` fields and the decision logic already
  accounts for a `pending_approval` state, but nothing in the admin UI sets
  `requiresApproval: true` yet — every grant created today is active
  immediately, with no approval step to wait on.
- **What this slice does — and doesn't — enforce.** `evaluateAccess()`
  computes a live allow/deny decision (with a reason) for a given
  user+site+time, and the admin UI exposes a "test access" tool to preview
  it. This is the decision logic only: there is **no proxy yet** applying
  that decision to real vendor traffic. Wiring `evaluateAccess()` into the
  connector-aware proxy path — so an actual browser request is allowed or
  blocked based on this — is a later slice (see Roadmap).

## Reverse proxy access

Once a grant is active, a vendor reaches the internal application by
browsing to a **per-site hostname** — `<site>.access.example.com` — which
the data-plane's browser-facing proxy listener (`PROXY_ADDR`, default
`:3103`) serves directly. This listener is a plain HTTP server; it expects
to sit behind your own **front reverse proxy** that terminates TLS (ideally
a wildcard certificate for `*.access.example.com`) and forwards by
hostname:

- `*.access.example.com` → `access-dataplane:3103` (the per-site proxy —
  the `Host` header, or `X-Forwarded-Host`, is how the data-plane looks up
  which `Site` and which connector/upstream a request belongs to)
- `manager.access.example.com` → `access-manager:3100` (the Manager UI:
  setup, invites, login, admin, `/access`)

Minimal **Caddy** example (automatic wildcard TLS via your DNS provider's
ACME DNS-01 plugin):

```caddyfile
*.access.example.com {
    tls {
        dns <your_dns_provider> <api_token>
    }
    @manager host manager.access.example.com
    handle @manager {
        reverse_proxy access-manager:3100
    }
    handle {
        reverse_proxy access-dataplane:3103 {
            header_up X-Forwarded-Host {host}
        }
    }
}
```

Minimal **nginx** example (assumes a wildcard cert already issued, e.g. via
`certbot` DNS-01):

```nginx
server {
    listen 443 ssl;
    server_name manager.access.example.com;
    ssl_certificate     /etc/ssl/access-wildcard/fullchain.pem;
    ssl_certificate_key /etc/ssl/access-wildcard/privkey.pem;
    location / {
        proxy_pass http://access-manager:3100;
        proxy_set_header Host $host;
    }
}

server {
    listen 443 ssl;
    server_name *.access.example.com;
    ssl_certificate     /etc/ssl/access-wildcard/fullchain.pem;
    ssl_certificate_key /etc/ssl/access-wildcard/privkey.pem;
    location / {
        proxy_pass http://access-dataplane:3103;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

### `COOKIE_DOMAIN` is required for cross-subdomain SSO

The vendor's session cookie is set when they log in on the Manager
(`manager.access.example.com`), but it has to be readable by the
data-plane's proxy on every `<site>.access.example.com` hostname too — a
different subdomain. For that, set `COOKIE_DOMAIN` to a **leading-dot**
domain that covers both:

```
COOKIE_DOMAIN=.access.example.com
```

Leave it empty for local development (a host-only cookie, since
`localhost` has no shared parent domain to scope to). If `COOKIE_DOMAIN` is
unset or wrong in production, vendors will be redirected back to `/login`
on every site request even though they're already logged in on the
Manager.

### What's enforced, and what isn't yet

Every request that reaches the data-plane's proxy is evaluated **live, on
every request** — there is no session-level cache: it resolves the session
cookie to a user, resolves the request's hostname to a `Site`, and calls
`evaluateAccess()` for that user+site+time before opening a connector
stream. A missing/expired session redirects to `/login?returnTo=`; a
resolved user without an active grant gets a 403 with the specific reason
(no grant, expired, not yet started, revoked, pending approval, or the
user account itself disabled). Revoking a grant takes effect on the vendor's
very next request — nothing is cached.

This slice does **not** yet include session isolation, session recording,
or credential vaulting — those are a planned future **Pro tier**, not part
of this open-source proxy. Every allowed and denied (authenticated) request
through this proxy is recorded to the audit trail — see "Audit & retention"
below.

## Audit & retention

Every request the data-plane's identity-aware proxy makes an access decision
on is recorded to an append-only `AuditEvent` table:

- **What's logged**: allowed requests, and denied requests **from an
  authenticated user** (no grant, expired, not yet started, revoked, pending
  approval, or a disabled account) — each row captures the timestamp, user,
  site, host/method/path, response status, bytes out, the decision
  (`ALLOW`/`DENY`) and its reason, client IP, and user agent.
- **What's not logged**: anonymous, unauthenticated requests (the ones that
  simply redirect to `/login`) never produce an audit row — there's no
  identity yet to attribute them to.
- **Append-only, with snapshots**: rows are never updated or linked by a
  live foreign key to `User`/`Site`. The user's email and the site's name are
  denormalized onto the row at write time, so the audit trail still reads
  correctly — and survives — after the underlying user or site is later
  deleted.
- **Viewing it**: admins can filter, paginate, and export the trail (CSV) at
  `/admin/audit`, or query it directly via `GET /api/admin/audit`.
- **Retention**: `AUDIT_RETENTION_DAYS` (default `730`) controls how long
  rows are kept — **set this per your own legal counsel** for your KVKK/5651
  retention obligations, not just the default. Cleanup isn't automatic; wire
  up `POST /api/cron/audit-retention` (Bearer `CRON_SECRET`) on a schedule,
  e.g. a host crontab entry running once a day:

```cron
0 3 * * * curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/audit-retention
```

  The endpoint fails closed: with `CRON_SECRET` unset, every call returns
  `401` and nothing is deleted.
- **Not included yet — tamper-evidence.** This audit log is append-only at
  the application layer, but nothing currently hash-chains rows or applies a
  trusted (RFC 3161-style) timestamp to make retroactive tampering
  detectable. That's documented future hardening, not a shipped guarantee —
  don't rely on this log as forensically tamper-evident today.

## Development

Requirements: **Node 20**, **pnpm 9.14.2**, Docker (for the local Postgres).

```bash
pnpm install
pnpm dev          # http://localhost:3100
pnpm build        # production build
pnpm test         # vitest
pnpm lint
pnpm typecheck
pnpm db:generate  # regenerate the Prisma client after a schema change
pnpm db:push      # push schema to the database (no migration files yet)
```

## License

[Apache License 2.0](./LICENSE).

## Security

This is a security product — please report vulnerabilities responsibly.
See [SECURITY.md](./SECURITY.md). Do not open public issues for security
reports.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
