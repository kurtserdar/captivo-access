# Gateway v2 — Slice B: bundled guacd + retire the web-app pack — Design

**Date:** 2026-08-11
**Status:** Approved for planning
**Area:** Connector / gateway deployment

## Problem

Native remote-desktop sessions need only **guacd** (the small protocol engine) reachable
through the connector. But the current gateway deployment is the old, heavy
`deploy/gateway/` pack — the full Guacamole **web app** + Postgres + header-auth + json-auth —
which the operator must run as a separate `setup.sh` step, and which the native model no
longer uses. Meanwhile the connector install is already a one-command experience.

## Goal (Slice B)

Installing a connector as a **gateway host** deploys guacd alongside it in the **same command**
— no separate pack, no Guacamole web app, no Postgres. The old `deploy/gateway/` pack and the
now-dead json-auth path are removed. Remote-desktop sites work with just: install connector
(gateway host) → add a Remote desktop site → connect.

## Key decisions (approved)

1. **guacd is bundled into the connector command** — when a connector is a gateway host, the
   generated install / re-pair / update command also runs guacd (idempotently).
2. **guacd is named `captivo-guacd`** on the `captivo-gateway` network; the manager's
   `GUACD_ADDR` default becomes `captivo-guacd:4822`. Each connector resolves its own local
   guacd by that name.
3. **The old `deploy/gateway/` pack and the json-auth path are removed** — Guacamole web app,
   Postgres, header-auth, json-auth, `guac-json.ts`, the launch route, the gateway-guide
   button. Native is the only gateway.
4. **Recording capture wiring is Slice C** — Slice B provisions the recordings volume so C can
   use it, but does not yet inject a recording path.

## Scope

**In scope (Slice B):**
- `runCommand` in `src/lib/connector/repair.ts`: when `gatewayHost`, prepend guacd
  provisioning (network ensure + recordings volume + chown + `captivo-guacd` run) to the
  connector `docker run`. Idempotent (`docker rm -f captivo-guacd` first). All three builders
  (install / re-pair / update) inherit it.
- `GUACD_ADDR` default → `captivo-guacd:4822` (the manager descriptor default in
  `src/app/api/internal/gateway/descriptor/route.ts`).
- Remove `deploy/gateway/` (compose, setup.sh, README, assets), `src/lib/gateway/assets.ts`,
  and the gateway-guide button/component.
- Remove the dead json-auth path: `src/app/api/access/gateway/[siteId]/launch/route.ts`,
  `src/lib/vault/guac-json.ts` (+ its test/fixtures), and the `GUAC_JSON_SECRET_KEY` usages.
- Update the connector install UI copy: the "gateway host" option explains it also runs guacd.
- Update install docs to the bundled flow; drop the gateway-pack walkthrough.

**Out of scope:** recording-path injection + the recording toggle (Slice C); multi-guacd /
per-connector guacd address overrides; guacd version pinning UI.

**Unchanged:** the data-plane guac-tunnel, the descriptor API's grant/vault logic, the native
session page — they keep working; only guacd's address default and deployment change.

## The bundled command

`runCommand(managerUrl, tunnelUrl, code?, gatewayHost)` — when `gatewayHost`, produces
(before the connector `docker run`):

```sh
docker network inspect captivo-gateway >/dev/null 2>&1 || docker network create captivo-gateway
docker run --rm -v captivo_guacd_recordings:/rec busybox chown -R 1000:1000 /rec
docker rm -f captivo-guacd >/dev/null 2>&1 || true
docker run -d --name captivo-guacd --restart unless-stopped --network captivo-gateway \
  -v captivo_guacd_recordings:/recordings guacamole/guacd:1.5.5
```

then the existing connector `docker run` (also joined to `captivo-gateway`). guacd runs as
uid 1000; the chown makes the named recordings volume writable by it (the same gotcha the old
pack solved with an init container). The whole thing is one shell command (joined with `&&` /
`;` as the builders already do), so re-running it (update / re-pair) safely replaces guacd.

`buildInstallCommand`, `buildReconfigureCommand`, and `buildConnectorUpdateCommand` all call
`runCommand`, so each carries guacd when `gatewayHost`.

## Manager changes

- `GUACD_ADDR` default in the descriptor route → `captivo-guacd:4822` (env override still wins).
- The connector-add UI: the existing "gateway host" toggle's help text mentions it deploys
  guacd for remote-desktop sites. No new fields.

## Removals

- `deploy/gateway/` directory (compose, setup.sh, README) — the whole web-app pack.
- `src/lib/gateway/assets.ts` (the embedded `GATEWAY_COMPOSE`) and its `/gateway/*` serving
  route + `scripts/gen-gateway-assets` if present.
- The gateway-guide button/component (`gateway-guide-button.tsx` and its usage).
- `src/app/api/access/gateway/[siteId]/launch/route.ts` (json-auth launch — dead: gateway
  sites have no hostname/web app).
- `src/lib/vault/guac-json.ts` + `guac-json.test.ts` + `rfc3161`-style fixtures for it.
- `GUAC_JSON_SECRET_KEY` references (manager env, gateway pack). Any remaining `VaultCredential`
  usage stays (it's the remote-desktop target store).

Grep-and-remove: after deletion, `grep -rn "guac-json\|GATEWAY_COMPOSE\|json-auth\|gateway/launch\|GUAC_JSON_SECRET_KEY"`
must return nothing in `src/`. Fix any dangling imports.

## Error handling

- The bundled command is copy-paste shell the operator runs; if guacd's image pull or run fails
  the operator sees Docker's error. The connector still installs (guacd is a preceding, `|| true`
  guarded step where safe) — but guacd failing means remote-desktop sessions won't connect until
  fixed (surfaced by the tunnel's existing "guacd unreachable" error).
- Removing the launch route: `/access` already routes GATEWAY Open to the native session page
  when `NATIVE_GATEWAY` is on (Slice A). With the launch route gone, ensure no code path still
  links to it (the session page's fallback `redirect` to the launch must be replaced with a
  plain error, since the launch no longer exists).

## Testing

- **`repair.ts` (pure unit):** `buildInstallCommand(code, m, t, true)` contains
  `--name captivo-guacd`, `--network captivo-gateway`, `captivo_guacd_recordings`, and the
  connector run; `gatewayHost=false` contains none of the guacd pieces. `buildConnectorUpdateCommand`
  and `buildReconfigureCommand` likewise carry guacd when gatewayHost. (Extend the existing
  repair tests.)
- **Build:** the grep-clean above passes; no dangling imports.
- **Gate A (operator):** on a fresh gateway host, run the generated gateway-host command → both
  `access-connector` and `captivo-guacd` come up on `captivo-gateway`; a Remote desktop site
  connects natively. (The user already validated the tunnel path; this validates the bundled
  deployment.)

## Deployment

- Manager image bump (descriptor default + UI copy + removed routes). Data-plane/connector
  images rebuild but are functionally unchanged for this slice (the connector already has the
  guacd relay). **Migration for existing installs:** re-run the gateway-host connector command
  once (brings up `captivo-guacd`), point `GUACD_ADDR` at `captivo-guacd:4822` (or rely on the
  new default), and remove the old `cap-guacamole` / `cap-guac-postgres` / `cap-guacd`
  containers by hand.
