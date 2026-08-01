# Captivo Access

![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)

**Open-source, self-hosted, VPN-less Zero Trust remote access for third-party vendors.**

Grant an external vendor or contractor passkey-authenticated, time-boxed,
audited access to one specific internal web app — without a VPN, without
opening an inbound port into your network, and without handing out a
standing credential. You self-host it: there is no SaaS, no vendor lock-in,
and no traffic that passes through anyone's infrastructure but your own.

> **Status: early development.** Passkey identity, the outbound-only
> connector tunnel, time-boxed access grants, the identity-aware reverse
> proxy, and the audit trail are all implemented and working end-to-end (see
> [Features](#features)). Session isolation/recording, credential vaulting,
> and tamper-evident audit are **not built yet** — see
> [Roadmap](#roadmap-not-yet). Not production-hardened; review the
> [Security model](#security-model) yourself before relying on it.

## Why

Most organizations that let vendors and contractors touch internal
applications do it one of two ways: a full VPN (broad network access, a
standing credential, an inbound endpoint to defend) or a shared login
handed over Slack. Neither is scoped, neither expires itself, and neither
gives you an audit trail of what the vendor actually touched. Captivo
Access is a narrower tool: point it at one internal app, give one vendor a
passkey and a time window, and every request they make is checked live and
logged.

If you just need a transparent identity-aware proxy in front of internal
web apps, this is in the same space as Cloudflare Access or Pomerium — with
a vendor-lifecycle (invite → time-boxed grant → revoke) and Turkish
KVKK/5651-style retention framing layered on top, and it's yours to run
on your own infrastructure.

## Architecture

```
 Vendor's browser
       │  HTTPS (passkey login, then per-site access)
       ▼
 Front proxy  (Caddy/nginx — TLS termination, routes by hostname)
       │
       ├──▶ Control plane   (Next.js, :3100)
       │    identity & passkeys, admin console,
       │    access grants, audit log, Postgres
       │
       └──▶ Data plane      (Go, :3103)
             identity-aware reverse proxy — checks the
             session + the access grant on every request
                   │
                   ▼
          outbound-only WSS tunnel (yamux-multiplexed)
                   │
 ══════════════════│══════════════════ network boundary ══════════════════
                   ▼
             Connector (Go — runs inside the customer network)
                   │  dials OUT to the data plane; never listens,
                   │  never accepts an inbound connection
                   ▼
             Internal web app  (wiki, admin panel, dashboard, ...)
```

Four moving pieces:

- **Control plane** — a Next.js app (`/`, this repo's root). Owns identity
  (WebAuthn passkeys + TOTP recovery), the admin console (connectors,
  sites, grants, audit), and Postgres.
- **Data plane** (`dataplane/`) — a Go service with three listeners: the
  public WSS endpoint connectors dial into, an internal API the control
  plane calls, and the browser-facing identity-aware reverse proxy that
  serves vendor traffic per site.
- **Connector** (`connector/`) — a small Go binary you run inside your own
  network. It dials **out** to the data plane over WSS and never opens a
  listening port; it holds a local allowlist of the internal services it's
  permitted to reach.
- **`tunnel/`** — the shared wire-format module (frames, dial requests,
  body streaming) used by both the data plane and the connector.

A vendor request is checked **live, on every single request** — session
cookie → user, hostname → site, `evaluateAccess(user, site, now)` → allow
or deny with a reason — before it's ever streamed to the connector.

## Features

Shipped and working today:

- **Passkey (WebAuthn) authentication**, no passwords anywhere — plus TOTP
  as a break-glass recovery path if a user loses every passkey.
- **Time-boxed access grants** — an admin ties one vendor to one site with
  an optional start/end window; a vendor's `/access` page shows what's
  active vs. upcoming.
- **Outbound-only connector** with a local upstream allowlist — the real
  internal `host:port` never leaves the customer's network.
- **Identity-aware reverse proxy** — host-based routing
  (`<site>.access.<domain>`), session + grant checked on every request,
  fail-closed.
- **Append-only audit log** — every allowed request and every authenticated
  denial is recorded, with KVKK/5651-oriented retention cleanup and CSV
  export from the admin console.
- **Dark/light admin console UI.**

Fields for an approval workflow (`requiresApproval` / `approvedAt`) exist in
the data model and the decision logic already accounts for a
`pending_approval` state — but nothing in the admin UI sets it yet, so every
grant created today is active immediately. See
[Roadmap](#roadmap-not-yet) for what's explicitly not built.

## Quick start (local/dev)

Requires Docker + Docker Compose v2.

```bash
git clone https://github.com/kurtserdar/captivo-access.git
cd captivo-access
cp .env.example .env
```

Edit `.env` and fill in the required secrets — each is a 32-byte hex value:

```bash
openssl rand -hex 32   # → POSTGRES_PASSWORD
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → ENCRYPTION_KEY
openssl rand -hex 32   # → DATAPLANE_SECRET
```

(`WEBAUTHN_RP_ID` can stay `localhost` for local dev — see
[Passkeys are bound to the domain](#passkeys-are-bound-to-the-domain) below
for why this matters once you deploy for real.)

Bring the stack up:

```bash
docker compose up -d --build
```

This starts Postgres, the control plane, and the data plane. On first run
against a fresh database, push the Prisma schema once:

```bash
pnpm install
DATABASE_URL="postgresql://access:<POSTGRES_PASSWORD>@localhost:5434/captivo_access" pnpm db:push
```

(substitute the `POSTGRES_PASSWORD` you put in `.env`; Postgres is exposed
on host port `5434` in dev to avoid clashing with other local Postgres
instances.)

Then open **http://localhost:3100/setup** and register the first account
as a passkey — it becomes the initial `ADMIN`. There's no seed/default
account.

## Production deploy

The repo-root `docker-compose.yml` above builds images locally and is meant
for development. For a real deployment — the published `ghcr.io` images,
fronted by [Caddy](https://caddyserver.com/) with automatic HTTPS for both
the admin console and the per-site vendor proxy — use the
[`deploy/`](deploy/README.md) scaffold instead:

```bash
cd deploy
cp .env.prod.example .env   # fill in ACCESS_DOMAIN and secrets
docker compose -f docker-compose.prod.yml up -d
```

Images are published to `ghcr.io/kurtserdar/captivo-access-{manager,dataplane,connector}`
on each `vX.Y.Z` release tag (plus `latest`) — see
[`.github/workflows/publish.yml`](.github/workflows/publish.yml). No image
has been tagged yet; until a release ships, build locally per the quick
start above. `deploy/README.md` also covers the wildcard-TLS trade-off (one
Caddy DNS-01 plugin vs. one explicit host block per vendor site) and how to
push the schema against the production database.

## How access works

1. **Add a connector.** An admin goes to `/admin/connectors`, names a
   connector, and gets back a one-time pairing code and a ready-to-copy
   `docker run` command. That command is run on a host **inside the
   customer's own network**, with `DATAPLANE_URL` (the data plane's
   TLS-terminated WSS tunnel endpoint, e.g. `wss://connect.<your-domain>`)
   and `UPSTREAMS` — a comma-separated `name=http://host:port`
   allowlist of the internal services this connector may reach (see
   [`connector/README.md`](./connector/README.md) for the full env
   reference). On first start the connector redeems the pairing code,
   stores a long-lived token in its `/data` volume, and dials the data
   plane — it then shows up as online.
2. **Add a site.** Under `/admin/sites`, the admin creates a `Site` that
   references a connector and one of its upstream **names** (never a raw
   host:port — the control plane and data plane never see or store the
   real internal address).
3. **Grant a vendor access.** At `/admin/grants`, the admin picks a vendor
   user, a site, and an optional start/end window, then saves. Revoking a
   grant is immediate and irreversible.
4. **The vendor signs in and connects.** The vendor is invited via a
   one-time link at `/admin/invites` (email + role + expiry), registers a
   passkey at `/invite/[token]` — no shared credentials ever exist — and
   logs in at `/login` with a discoverable passkey (no username field). Once
   their grant is active, they open `https://<site>.access.<domain>`
   directly; the data plane resolves their session, checks the grant, and
   — if allowed — streams the request through the connector's tunnel to
   the real internal app.
5. **Everything is audited.** Every allowed request, and every denied
   request from an authenticated user, is written to the audit log (see
   [Security model](#security-model)).

If a passkey user ever loses every registered passkey, `/recover` accepts
their email plus a TOTP code (set up in advance) and lets them register a
new one; every failure path returns the same generic error, so the response
never reveals whether an email exists or which check failed.

#### Passkeys are bound to the domain

WebAuthn passkeys are bound to the *Relying Party ID* at registration and
re-checked on every login. **`WEBAUTHN_RP_ID` must be the exact domain the
control plane is served from** (no scheme, no port) — `localhost` for
local dev, `access.yourcompany.com` for production. If it doesn't match the
browser's address bar, registration and login fail silently with no useful
client-side error. Set it correctly *before* anyone registers a passkey:
changing it later invalidates every passkey already enrolled. In production
the origin must also be HTTPS — browsers refuse WebAuthn over plain HTTP
for any RP ID other than `localhost`.

Cross-subdomain session sharing (the admin console at
`manager.access.<domain>` and every vendor site at
`<site>.access.<domain>`) requires `COOKIE_DOMAIN` set to a leading-dot
domain covering both, e.g. `.access.yourcompany.com` — left empty, it
defaults to a host-only cookie, fine for local dev but broken across
subdomains in production. The `deploy/` scaffold's Caddyfile already routes
`manager.<ACCESS_DOMAIN>` and `*.<ACCESS_DOMAIN>` to the right service by
`Host` / `X-Forwarded-Host`; if you're fronting it with your own proxy
instead, replicate that routing and forward those headers.

## Security model

- **Outbound-only connector, no inbound port.** The connector inside your
  network only ever dials out to the data plane over WSS/443; it never
  listens on a socket and never needs a firewall rule opened toward it.
- **Local upstream allowlist.** The control plane and data plane reference
  an upstream by **name** only (e.g. `wiki`) — the connector resolves that
  name against its own `UPSTREAMS` env var, which lives solely in the
  customer's own container. A name the connector doesn't recognize is
  rejected and the stream is closed. The real internal `host:port` is
  never transmitted to, stored on, or visible from the control/data plane.
- **Passkey-only identity.** No password exists anywhere in the system —
  WebAuthn passkeys for normal login, TOTP only as a break-glass recovery
  path (itself encrypted at rest, AES-256-GCM).
- **Fail-closed access checks, live on every request.** There is no
  session-level cache: the data plane's proxy resolves the session,
  resolves the hostname to a `Site`, and calls `evaluateAccess()` for that
  user + site + time before opening a connector stream — on **every**
  request. A missing/expired session redirects to `/login`; a resolved user
  without an active grant gets a 403 with a specific reason (no grant,
  expired, not yet started, revoked, pending approval, or a disabled
  account). Revoking a grant takes effect on the vendor's very next
  request — nothing is cached.
- **Append-only audit log.** Every allowed request, and every denied
  request from an authenticated user, is written to an `AuditEvent` row —
  timestamp, user, site, host/method/path, response status, bytes out, the
  decision and its reason, client IP, and user agent. Anonymous requests
  that simply redirect to `/login` aren't logged (there's no identity yet
  to attribute them to). Rows are denormalized (the user's email and site's
  name are captured at write time) so the trail still reads correctly after
  the underlying user or site is later deleted, and are never updated —
  only inserted. Admins can filter, paginate, and export to CSV at
  `/admin/audit`.
- **Retention, not indefinite storage.** `AUDIT_RETENTION_DAYS` (default
  `730`) governs how long rows are kept — set this to match your own
  KVKK/5651 obligations, not just the default. Cleanup isn't automatic:
  wire `POST /api/cron/audit-retention` (Bearer `CRON_SECRET`) into a
  scheduler, e.g. a daily cron entry. The endpoint fails closed — with
  `CRON_SECRET` unset, every call returns `401` and nothing is deleted.
- **What this log is *not*, yet:** it's append-only at the application
  layer, but nothing hash-chains rows or applies a trusted timestamp to
  make retroactive tampering detectable. Don't treat it as forensically
  tamper-evident today — see [Roadmap](#roadmap-not-yet).

## Roadmap / not yet

Explicitly **not** built — don't assume these exist:

- **Session isolation / remote-browser rendering, session recording, and
  credential vaulting** — planned as a future "Pro" tier on top of this
  open-source proxy, not part of it today.
- **Tamper-evident audit** — hash-chaining audit rows and/or a trusted
  (RFC 3161-style) timestamp on the log.
- **Turkish UI (i18n)** — the console is English-only right now, despite
  the KVKK/5651-oriented retention framing.
- **RDP/SSH bridging** — this is an HTTP(S) reverse proxy today, not a
  general-purpose bastion.
- **Recurring/scheduled access windows** — grants are a single start/end
  window today, no repeating schedule.
- **A working approval flow** — the data model supports a pending-approval
  state, but no admin UI path sets `requiresApproval` yet.

## Development

Requirements: **Node 20**, **pnpm 9.14.2**, Docker (for local Postgres).

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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contributor workflow
and PR checklist.

## License

[Apache License 2.0](./LICENSE).

## Security

This is a security product — please report vulnerabilities responsibly. See
[SECURITY.md](./SECURITY.md). Do not open public issues for security
reports.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
