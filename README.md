# Captivo Access

**Open-source, self-hosted Zero-Trust / VPNless secure remote access for third-party vendors and contractors.**

> ⚠️ **Status: early development (Slice 0 — skeleton).** This repository currently
> contains the project scaffold (Next.js app, Postgres/Prisma, Docker packaging,
> CI) and **no product functionality yet** (no identity/Passkey, no connector
> tunnel, no access model, no proxy, no audit trail). **Not production-ready.**
> Do not deploy this for real vendor access today — track the roadmap below.

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
| 1 | Identity + Passkey — admin & vendor users, WebAuthn register/login, TOTP fallback, sessions |
| 2 | Connector tunnel — Go connector (outbound-only), Manager↔Connector protocol |
| 3 | Access model — `AccessGrant` (role + time window + approval-dormant), admin UI |
| 4 | Identity-aware proxy — route an authorized vendor through the connector to the internal app |
| 5 | Session audit + KVKK/5651 — signed audit trail (who/when/what app/how long) |

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
in real deployments — `.env` lets you set `WEBAUTHN_RP_ID` to your domain
once Passkey support lands (Slice 1).

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

---

## Türkçe özet

**Captivo Access**, tedarikçilere ve dış yüklenicilere VPN gerektirmeden,
kimlik-farkındalıklı ve süreli erişim veren, **açık kaynak ve self-hosted**
bir Zero-Trust uzaktan erişim ürünüdür. CyberArk Alero / Remote Access
muadili; Türk pazarı için KVKK/5651 uyumluluğu gözetilerek geliştiriliyor.
SaaS işletmiyoruz — yazılımı siz kendi altyapınızda barındırırsınız.

**Durum: erken geliştirme aşaması (Dilim 0 — iskelet).** Bu depo şu an yalnızca
proje iskeletini (Next.js uygulaması, Postgres/Prisma, Docker paketleme, CI)
içerir; kimlik doğrulama, connector tüneli, erişim modeli, proxy ve denetim
kaydı gibi ürün özellikleri **henüz yok**. **Üretime hazır değildir** — gerçek
tedarikçi erişimi için bugün kullanmayın.

Self-host kurulumu ve geliştirme adımları için yukarıdaki İngilizce bölümlere
bakınız; komutlar dile bağlı değildir. Lisans: Apache-2.0. Güvenlik açığı
bildirimi için [SECURITY.md](./SECURITY.md) dosyasına bakınız.
