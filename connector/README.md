# Captivo Access — connector

The connector is a small agent you run inside your own network (on-prem,
private VPC, home lab — anywhere that isn't internet-reachable). It:

- enrolls with the Manager using a one-time pairing code, storing a
  long-lived connector token on disk,
- dials **out** to the data-plane over WSS (never accepts inbound
  connections, never needs an open firewall port),
- proxies HTTP requests from the data-plane to the internal address the
  Manager sends for each request — that address is defined once, per app,
  as a **Site** in the Manager console, not on the connector itself.

It shares wire-format and dial types with the data-plane via the
[`tunnel`](../tunnel) module.

## Environment variables

| Variable        | Required | Meaning                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------ |
| `MANAGER_URL`     | yes      | Base URL of the Manager (used for enrollment/pairing).                  |
| `DATAPLANE_URL`   | yes      | TLS-terminated WSS URL of the data-plane tunnel to dial, e.g. `wss://connect.access.example.com`. Use `wss://` — a plain `ws://` tunnel is unencrypted. |
| `PAIR_CODE`       | first run only | One-time pairing code from the Manager UI. Only needed until a token is stored at `TOKEN_FILE`; ignored afterwards. |
| `ALLOWED_TARGETS` | no       | Optional egress boundary: comma-separated CIDRs/hosts/`host:port`s, e.g. `10.0.5.0/24,jira.internal,192.168.1.50:8080`. If set, the connector refuses to dial any target outside this list, even if a Site's internal address points there. Unset means it dials whatever the Manager routes to it. |
| `TOKEN_FILE`      | no       | Path to the stored connector token. Default: `/data/token`.            |

Upstream targets themselves aren't configured on the connector at all —
each internal app is defined as a **Site** (with its internal address) in
the Manager console, and the connector dials whatever address the Manager
sends it for a given request, subject to `ALLOWED_TARGETS` if set.

## Ports

None. The connector makes only outbound connections (to `MANAGER_URL` and
`DATAPLANE_URL`) and never listens on a socket.

## Data

The connector token issued at enrollment is written to `TOKEN_FILE`
(default `/data/token`) so the container can restart and reconnect without
needing `PAIR_CODE` again. Mount `/data` as a volume so the token survives
container recreation.

## Building

The Docker build context is the **repository root** (not this directory),
because the module depends on the sibling `tunnel/` module via a `replace`
directive in `connector/go.mod`:

```bash
docker build -f connector/Dockerfile -t captivo-access-connector .
```

See [`Dockerfile`](./Dockerfile) for why the repo-root `go.work` is
intentionally *not* copied into the build context.

## Running

Prebuilt images are published to GitHub Container Registry on each
`vX.Y.Z` release tag, so you don't need to build locally — just pull and
run:

```bash
docker run -d \
  --name captivo-access-connector \
  -e MANAGER_URL=https://access.example.com \
  -e DATAPLANE_URL=wss://connect.access.example.com \
  -e PAIR_CODE=<one-time code from the Manager UI> \
  -v conn-data:/data \
  ghcr.io/kurtserdar/captivo-access-connector:latest
```

To cap what this connector may reach, add `-e ALLOWED_TARGETS=10.0.5.0/24`
(or a comma-separated list of CIDRs/hosts) to the command above — optional,
and unrelated to which apps route through this connector, which is decided
entirely by Sites in the Manager.

You can still build from source with the `docker build` command above if
you prefer (or need a version that hasn't been tagged yet).

On first start, the connector redeems `PAIR_CODE` and stores its token in
the `conn-data` volume. On subsequent restarts, `PAIR_CODE` is no longer
needed (and is ignored if still set) — the connector reads its stored token
from `/data/token` and reconnects.
