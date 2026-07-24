# Contributing to Captivo Access

Thanks for your interest in contributing. This project is in early
development (Slice 0 — skeleton), so expect the codebase and conventions to
shift quickly.

## Requirements

- **Node.js 20** (see `.nvmrc`)
- **pnpm 9.14.2** (`corepack enable pnpm` or `corepack pnpm@9.14.2 <cmd>`)
- **Docker** + Docker Compose (for the local Postgres instance)

## Setup

```bash
git clone https://github.com/kurtserdar/captivo-access.git
cd captivo-access
pnpm install
cp .env.example .env   # edit DATABASE_URL / POSTGRES_PASSWORD / SESSION_SECRET
pnpm db:generate
pnpm dev
```

## Commands

```bash
pnpm dev          # dev server, http://localhost:3100
pnpm build        # production build
pnpm test         # vitest
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm db:generate  # regenerate Prisma client after a schema change
pnpm db:push      # push schema to the database
```

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before
opening a PR — the same checks run in CI.

## Commit style

Short, imperative commit messages (`feat: ...`, `fix: ...`, `docs: ...`,
`chore: ...`). Keep PRs focused on a single change.

## Pull requests

1. Fork the repo and create a branch off `main`.
2. Make your change, keeping it scoped and covered by tests where practical.
3. Ensure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
4. Open a PR describing the change and why it's needed.

## Reporting security vulnerabilities

**Do not open a public issue for a security vulnerability.** See
[SECURITY.md](./SECURITY.md) for how to report it privately.

## License

By contributing, you agree that your contributions will be licensed under
the [Apache License 2.0](./LICENSE), the same license as the rest of the
project.
