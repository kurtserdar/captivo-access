# In-Stack Cron Sidecar — Design

**Status:** Approved (brainstorm 2026-08-13). Decision: Option A — a cron sidecar container in the Compose stack; drop host-crontab install.
**Backlog:** punch-list #14 ("cron auto-installs on the end-user server — the user shouldn't have to deal with it").
**Ships as:** v0.56.0 (deploy-stack + docs only — no app/image code change; the tag is the delivery marker for self-hosters).

## Problem

Scheduled jobs already auto-install via `deploy/setup.sh` → `install_cron`, but
through a **host crontab** that curls the **public** `https://manager.<domain>`
endpoints. Three weaknesses leave the user to "deal with it":

1. **Needs host `crontab`** — absent on minimal / container-first hosts, where
   `install_cron` falls back to printing lines for the user to add by hand.
2. **External round-trip** — depends on public DNS + TLS being live and the host
   resolving its own public name; fragile at setup time and a needless hop, since
   the manager sits in the same stack.
3. **Set once at setup** — a wiped crontab (or setup not re-run) silently stops
   retention/health forever.

The manager is reachable in-stack at `http://access-manager:3100` (the data-plane
already uses it). The deploy compose has no `networks:` block — all services share
the default network and resolve each other by service name.

## Fix — an `access-cron` sidecar

A tiny always-on container in `deploy/docker-compose.prod.yml` runs a scheduler
loop that POSTs the four cron endpoints **internally** with `CRON_SECRET`. Host-
agnostic, zero host config, `restart: unless-stopped` self-heals, no DNS/TLS
dependency. Matches the existing "external trigger, no in-app scheduler"
architecture — the trigger just moves from host cron into the stack.

**Cadence (interval loop, not wall-clock cron — these jobs don't need a specific minute):**
- `site-health` — every 5 minutes
- `audit-retention`, `recording-retention`, `audit-anchor` — once every 24 h

The four endpoints and their meaning are unchanged from `install_cron` today.

## The scheduler — `deploy/cron/scheduler.sh` (new)

A POSIX-`sh` loop. Fails fast if `CRON_SECRET` is missing; waits briefly for the
manager on cold boot; fires `site-health` each tick and the daily batch every 288
ticks (288 × 5 min = 24 h). `hit()` always returns success so the loop never dies
on a transient endpoint error; each call logs ok/failed to stdout/stderr (visible
in `docker logs access-cron`).

```sh
#!/bin/sh
# Captivo Access in-stack scheduler. Fires the manager's cron endpoints on an
# interval (site-health every 5 min; retention + anchor once a day) over the
# internal Docker network — no host crontab, no public round-trip.
BASE="${MANAGER_URL:-http://access-manager:3100}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "cron: CRON_SECRET is not set — refusing to start" >&2
  exit 1
fi

hit() {
  if curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" "$BASE/api/cron/$1" -o /dev/null; then
    echo "cron: $1 ok"
  else
    echo "cron: $1 failed" >&2
  fi
}

DAILY_EVERY=288   # 288 * 5 min = 24 h
i=0
sleep 20          # let the manager finish starting on a cold boot
while true; do
  hit site-health
  if [ "$i" -eq 0 ]; then
    hit audit-retention
    hit recording-retention
    hit audit-anchor
  fi
  i=$(( (i + 1) % DAILY_EVERY ))
  sleep 300
done
```

(Daily batch runs once at container start — retention is idempotent, audit-anchor
is a no-op unless External anchor is enabled — then every 24 h.)

## Compose service — `deploy/docker-compose.prod.yml`

Add after the `access-dataplane` service (before `caddy`), on the default network:

```yaml
  access-cron:
    image: curlimages/curl:latest
    container_name: access-cron
    restart: unless-stopped
    depends_on:
      - access-manager
    environment:
      CRON_SECRET: ${CRON_SECRET:?required}
      MANAGER_URL: http://access-manager:3100
    entrypoint: ["/bin/sh", "/scheduler.sh"]
    volumes:
      - ./cron/scheduler.sh:/scheduler.sh:ro
```

`curlimages/curl` is alpine-based (busybox `sh`/`sleep` + `curl`), tiny, and needs
no build. The script is mounted from the deploy folder the self-hoster already has.

## `deploy/setup.sh` changes

- **Remove** `print_cron_lines()` and `install_cron()` and the `install_cron` call.
- **Add** `remove_legacy_cron()` and call it in place of `install_cron`: if a host
  crontab exists and contains the old managed marker, strip the managed block so an
  upgrading server doesn't double-fire (host cron **and** sidecar). Keep the
  existing `CRON_MARKER` constant for the match.

```sh
# remove_legacy_cron strips the pre-v0.56 host-crontab block managed by older
# setup.sh versions. Scheduling now lives in the access-cron container, so leaving
# the old block would double-fire the endpoints. Safe no-op when absent.
remove_legacy_cron() {
  command -v crontab >/dev/null 2>&1 || return 0
  crontab -l 2>/dev/null | grep -qF "$CRON_MARKER" || return 0
  crontab -l 2>/dev/null \
    | grep -vF "$CRON_MARKER" \
    | grep -vE '/api/cron/(site-health|audit-retention|recording-retention|audit-anchor)' \
    | crontab -
  echo "→ Removed the legacy host-crontab jobs (scheduling now runs in the access-cron container)."
}
```

- Update the closing message: replace the old "Scheduled background jobs …" line
  context — the success banner should note that background jobs run in the
  `access-cron` container automatically.

## Docs

- `deploy/README.md` (~263-278) and `docs/install.md` (~290-305): replace the
  "add these to the host's crontab" block with a short note that scheduling is
  **automatic** via the `access-cron` service in the Compose stack (no host cron
  needed), and that `docker logs access-cron` shows job runs. Keep a one-line
  manual-cron fallback only for users who deliberately run the manager outside the
  provided compose.

## Non-goals / guardrails

- **No app/image code change** — manager/data-plane/connector untouched. Only
  `deploy/` files + docs.
- Endpoints, cadence intent, and `CRON_SECRET` semantics unchanged.
- Not switching to an in-app scheduler (would break the "no in-app scheduler"
  design and double-fire on multi-instance).
- The user's own production (host-nginx compose at `/opt/captivo-access-prod`) is a
  **separate** stack — this changes the *shipped* `deploy/` only. Adopting the
  sidecar there is optional and out of scope.

## Testing

- `docker compose -f deploy/docker-compose.prod.yml config` parses cleanly (service
  + volume + env valid).
- `sh -n deploy/cron/scheduler.sh` (and `shellcheck` if available) — no syntax
  errors; `setup.sh` still `sh -n`-clean.
- **Live smoke** (proves the internal POST + secret pattern against the running
  manager): from a throwaway `curlimages/curl` container on the manager's network,
  `curl -fsS -X POST -H "Authorization: Bearer <CRON_SECRET>" http://<manager>:3100/api/cron/site-health`
  returns 2xx; a wrong/absent secret returns 401.
- Gate A (on a deploy-stack host): `docker logs access-cron` shows `cron:
  site-health ok` within ~20 s of start and the daily lines once; killing the
  container and `up -d` brings it back (self-heal).

## Deploy

**v0.56.0**, tag-only marker (no image behaviour change; publish.yml rebuilds
identical images). Push `deploy/` + docs, tag `v0.56.0`, then an English
`gh release edit` note telling self-hosters cron now runs automatically in-stack
(re-pull `deploy/` + `docker compose up -d`; the legacy host crontab is cleaned up
on the next `setup.sh` run).
