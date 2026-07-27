# Captivo Access — data-plane

The data-plane is the internet-reachable relay that connectors dial out to.
It accepts a WSS connection from each connector (backed by a
[yamux](https://github.com/hashicorp/yamux) multiplexed session), keeps a
registry of currently-connected connectors, and exposes an internal HTTP API
that the [Manager](../README.md) uses to proxy an allowlisted request through
a specific connector to one of its configured upstreams.

It shares wire-format and dial types with the connector via the
[`tunnel`](../tunnel) module.

## Ports

| Port | Address env    | Audience                                             |
| ---- | -------------- | ----------------------------------------------------- |
| 3101 | `WSS_ADDR`     | Public — connectors dial in here (`/tunnel`, `/healthz`) |
| 3102 | `INTERNAL_ADDR`| Compose-internal only — **must not** be published to the host/internet |

In `docker-compose.yml`, only `3101:3101` is published; `3102` is reachable
solely from other containers on the compose network (the Manager calls
`http://access-dataplane:3102/proxy`).

## Environment variables

| Variable            | Default                        | Meaning                                                              |
| -------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `DATAPLANE_SECRET`    | *(required)*                    | Shared secret checked on the internal `/proxy` API (`x-dataplane-secret` header). Must match the Manager's `DATAPLANE_SECRET`. |
| `CONTROL_PLANE_URL`   | `http://access-manager:3100`   | Base URL of the Manager, used for control-plane callbacks.            |
| `WSS_ADDR`            | `:3101`                        | Listen address for the public connector-facing WSS endpoint.          |
| `INTERNAL_ADDR`       | `:3102`                        | Listen address for the internal proxy API. Keep this off any public port mapping. |

## Building

The Docker build context is the **repository root** (not this directory),
because the module depends on the sibling `tunnel/` module via a `replace`
directive in `dataplane/go.mod`:

```bash
docker build -f dataplane/Dockerfile -t captivo-access-dataplane .
```

See [`Dockerfile`](./Dockerfile) for why the repo-root `go.work` is
intentionally *not* copied into the build context.

## Running (via compose)

The data-plane is started as part of the full stack:

```bash
docker compose up -d access-dataplane
```

It has no persistent state of its own — connector sessions live only in
memory and are re-established on reconnect.
