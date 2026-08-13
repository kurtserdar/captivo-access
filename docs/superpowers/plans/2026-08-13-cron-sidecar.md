# In-Stack Cron Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the manager's scheduled jobs run automatically inside the Compose stack via an `access-cron` sidecar, so a self-hoster never touches host cron.

**Architecture:** A tiny `curlimages/curl` container runs `deploy/cron/scheduler.sh`, an interval loop that POSTs the four cron endpoints on the internal network (`http://access-manager:3100`). `setup.sh` stops installing a host crontab and instead strips any legacy managed block. Docs updated to say scheduling is automatic.

**Tech Stack:** Docker Compose, POSIX `sh`, `curl`.

## Global Constraints

- **English only** — code, comments, commit messages. **No Claude signature.**
- **Deploy-stack + docs only** — no app / image / manager / data-plane / connector code change. Ships as **v0.56.0** (tag-only delivery marker).
- Endpoints (`site-health`, `audit-retention`, `recording-retention`, `audit-anchor`), `CRON_SECRET` semantics, and cadence intent (health every 5 min; the other three daily) are unchanged.
- Internal manager URL: `http://access-manager:3100`. The deploy compose has **no `networks:` block** — services share the default network and resolve by service name.
- Not an in-app scheduler; do not add one.

---

### Task 1: `deploy/cron/scheduler.sh`

**Files:**
- Create: `deploy/cron/scheduler.sh`

**Interfaces:**
- Consumes (env): `CRON_SECRET` (required), `MANAGER_URL` (default `http://access-manager:3100`).
- Produces: a long-running POSIX-`sh` loop; `hit <endpoint>` POSTs `"$MANAGER_URL/api/cron/<endpoint>"` with the bearer secret and logs ok/failed.

- [ ] **Step 1: Write the script**

Create `deploy/cron/scheduler.sh`:

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

- [ ] **Step 2: Make it executable**

Run: `chmod +x deploy/cron/scheduler.sh`

- [ ] **Step 3: Verify it parses (and lint if available)**

Run: `sh -n deploy/cron/scheduler.sh && echo "syntax ok"`
Expected: `syntax ok`.
If `shellcheck` is installed: `shellcheck deploy/cron/scheduler.sh` — expect no errors (warnings about `sleep` in a loop are acceptable).

- [ ] **Step 4: Commit**

```bash
git add deploy/cron/scheduler.sh
git commit -m "feat(deploy): in-stack cron scheduler script (interval loop over internal endpoints)"
```

---

### Task 2: `access-cron` service in the deploy compose

**Files:**
- Modify: `deploy/docker-compose.prod.yml` (insert a service between `access-dataplane` and `caddy`)

**Interfaces:**
- Consumes: `deploy/cron/scheduler.sh` (Task 1), `CRON_SECRET` from `.env`.

- [ ] **Step 1: Add the service**

In `deploy/docker-compose.prod.yml`, the `access-dataplane` service ends with:

```yaml
    expose:
      - "3101"
      - "3103"

  caddy:
```

Insert the `access-cron` service between them so it reads:

```yaml
    expose:
      - "3101"
      - "3103"

  # In-stack scheduler: POSTs the manager's cron endpoints on the internal
  # network (health every 5 min; retention + audit-anchor daily). Replaces the
  # old host-crontab install — works on any host with zero host configuration.
  access-cron:
    image: curlimages/curl:latest
    container_name: access-cron
    restart: unless-stopped
    depends_on:
      access-manager:
        condition: service_started
    environment:
      CRON_SECRET: ${CRON_SECRET:?required}
      MANAGER_URL: http://access-manager:3100
    entrypoint: ["/bin/sh", "/scheduler.sh"]
    volumes:
      - ./cron/scheduler.sh:/scheduler.sh:ro

  caddy:
```

- [ ] **Step 2: Validate the compose file**

Run: `docker compose -f deploy/docker-compose.prod.yml config >/dev/null && echo "compose ok"`
Expected: `compose ok` (no parse/interpolation error). If it complains that `CRON_SECRET` is unset in this shell, run with a dummy: `CRON_SECRET=x POSTGRES_PASSWORD=x SESSION_SECRET=x ENCRYPTION_KEY=x DATAPLANE_SECRET=x MANAGER_PUBLIC_URL=https://x ACCESS_DOMAIN=x docker compose -f deploy/docker-compose.prod.yml config >/dev/null && echo "compose ok"`.

- [ ] **Step 3: Commit**

```bash
git add deploy/docker-compose.prod.yml
git commit -m "feat(deploy): access-cron sidecar service in the production compose"
```

---

### Task 3: `setup.sh` — drop host-cron install, clean up legacy block

**Files:**
- Modify: `deploy/setup.sh`

**Interfaces:**
- Consumes: `CRON_MARKER` constant (kept), host `crontab` (optional).

- [ ] **Step 1: Remove `print_cron_lines` and `install_cron`**

Delete these two function definitions in full (keep the `CRON_MARKER` line above them):

```sh
print_cron_lines() {
  _d="$1"; _s="$2"
  # site-health every 5 min; audit + recording retention daily (staggered);
  # audit-anchor daily (no-op unless External anchor is enabled in Policy).
  printf '%s\n' "*/5 * * * * curl -sS -X POST -H \"Authorization: Bearer ${_s}\" https://manager.${_d}/api/cron/site-health >/dev/null 2>&1"
  printf '%s\n' "23 3 * * * curl -sS -X POST -H \"Authorization: Bearer ${_s}\" https://manager.${_d}/api/cron/audit-retention >/dev/null 2>&1"
  printf '%s\n' "35 3 * * * curl -sS -X POST -H \"Authorization: Bearer ${_s}\" https://manager.${_d}/api/cron/recording-retention >/dev/null 2>&1"
  printf '%s\n' "36 3 * * * curl -sS -X POST -H \"Authorization: Bearer ${_s}\" https://manager.${_d}/api/cron/audit-anchor >/dev/null 2>&1"
}

# install_cron schedules the manager's background jobs so retention/health
# actually run — the #1 thing a self-hoster otherwise forgets, silently leaving
# a "delete old recordings" policy that never fires. Idempotent + self-healing:
# it strips any prior managed block (even with an old secret/domain) and re-adds
# a fresh one. If crontab is unavailable it prints the lines to add by hand.
install_cron() {
  _s="$(grep -E '^CRON_SECRET=' .env 2>/dev/null | cut -d= -f2-)"
  _d="$(grep -E '^ACCESS_DOMAIN=' .env 2>/dev/null | cut -d= -f2-)"
  if [ -z "$_s" ] || [ -z "$_d" ]; then
    echo "→ Skipping cron install (CRON_SECRET/ACCESS_DOMAIN not found in .env)."
    return
  fi
  if ! command -v crontab >/dev/null 2>&1; then
    echo "→ 'crontab' not available — add these scheduled jobs yourself (see docs):"
    print_cron_lines "$_d" "$_s"
    return
  fi
  _existing="$(crontab -l 2>/dev/null | grep -vF "$CRON_MARKER" | grep -vE '/api/cron/(site-health|audit-retention|recording-retention)' || true)"
  { [ -n "$_existing" ] && printf '%s\n' "$_existing"; printf '%s\n' "$CRON_MARKER"; print_cron_lines "$_d" "$_s"; } | crontab -
  echo "→ Scheduled background jobs (site-health every 5 min; audit + recording retention daily)."
}
```

Replace that whole span with the new cleanup function:

```sh
# remove_legacy_cron strips the pre-v0.56 host-crontab block managed by older
# setup.sh versions. Scheduling now lives in the access-cron container, so
# leaving the old block would double-fire the endpoints. Safe no-op when absent.
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

- [ ] **Step 2: Swap the call site**

Replace the `install_cron` invocation line (after `docker compose … up -d`):

```sh
install_cron
```

with:

```sh
remove_legacy_cron
```

- [ ] **Step 3: Note automatic scheduling in the closing banner**

In the final `cat <<EOF … EOF` banner, replace:

```sh
Re-running ./setup.sh is safe — it reuses .env and re-applies the stack.
```

with:

```sh
Background jobs (health probes + audit/recording retention) run automatically in
the access-cron container — check them with: docker logs access-cron

Re-running ./setup.sh is safe — it reuses .env and re-applies the stack.
```

- [ ] **Step 4: Verify it parses**

Run: `sh -n deploy/setup.sh && echo "syntax ok"`
Expected: `syntax ok`. Also confirm nothing still references the removed functions:
Run: `grep -nE 'install_cron|print_cron_lines' deploy/setup.sh || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add deploy/setup.sh
git commit -m "feat(deploy): setup.sh drops host-cron install, cleans up legacy block"
```

---

### Task 4: Docs — scheduling is automatic

**Files:**
- Modify: `deploy/README.md` (the "Scheduled jobs (cron)" section)
- Modify: `docs/install.md` (the cron section)

**Interfaces:** none.

- [ ] **Step 1: Update `deploy/README.md`**

Replace the intro paragraph + the ```cron code block (from `The Manager doesn't run its own scheduler` through the closing ``` of the crontab block) with:

```markdown
The Manager doesn't run its own scheduler — the cron endpoints are triggered by
the **`access-cron`** container in the Compose stack, which POSTs them on the
internal network with the `CRON_SECRET` Bearer token (health every 5 minutes;
audit + recording retention and the audit-anchor once a day). `./setup.sh` (and
`docker compose … up -d`) start it automatically — **no host crontab needed**.
Check it with `docker logs access-cron`; the console also warns on the Policy page
if a job stops running.

If you run the Manager **outside** the provided compose, trigger the same four
endpoints yourself (`site-health`, `audit-retention`, `recording-retention`,
`audit-anchor`) — e.g. from a host crontab POSTing
`https://manager.<ACCESS_DOMAIN>/api/cron/<name>` with the `CRON_SECRET` bearer.
```

- [ ] **Step 2: Update `docs/install.md`**

Replace the blockquote note + the intro sentence + the ```cron block (from the `> **If you used ./setup.sh …` blockquote through the closing ``` of the crontab block) with:

```markdown
Scheduling is **automatic**: the `access-cron` container in the Compose stack POSTs
the four cron endpoints on the internal network with the `CRON_SECRET` bearer
token (`site-health` every 5 minutes; `audit-retention`, `recording-retention`,
and `audit-anchor` once a day). `./setup.sh` and `docker compose … up -d` start it
for you — no host crontab required. Watch it with `docker logs access-cron`.

If you run the Manager outside the provided `docker-compose.prod.yml`, trigger the
same endpoints yourself from the host's cron, POSTing
`https://manager.<your-domain>/api/cron/<name>` with the `CRON_SECRET` bearer token.
```

- [ ] **Step 3: Sanity-check the edits**

Run: `grep -n "access-cron" deploy/README.md docs/install.md`
Expected: at least one match in each file.
Run: `grep -nE '\*/5 \* \* \* \*' deploy/README.md docs/install.md || echo "no stale crontab tables"`
Expected: `no stale crontab tables` (the multi-line crontab examples were removed).

- [ ] **Step 4: Commit**

```bash
git add deploy/README.md docs/install.md
git commit -m "docs(deploy): scheduling is automatic via the access-cron container"
```

---

### Task 5: Whole-feature verification + live smoke

**Files:** none.

- [ ] **Step 1: Re-verify all shell + compose parse**

Run:
```bash
sh -n deploy/cron/scheduler.sh && sh -n deploy/setup.sh && echo "sh ok"
CRON_SECRET=x POSTGRES_PASSWORD=x SESSION_SECRET=x ENCRYPTION_KEY=x DATAPLANE_SECRET=x MANAGER_PUBLIC_URL=https://x ACCESS_DOMAIN=x docker compose -f deploy/docker-compose.prod.yml config >/dev/null && echo "compose ok"
```
Expected: `sh ok` and `compose ok`.

- [ ] **Step 2: Live smoke — internal POST + secret pattern**

Against the running manager (container `cap-access-manager` on its compose
network — read the real secret from that stack's `.env`/env), confirm the endpoint
the sidecar will call responds:

```bash
SECRET=$(docker exec cap-access-manager sh -c 'echo $CRON_SECRET')
docker run --rm --network "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' cap-access-manager)" \
  curlimages/curl:latest -fsS -X POST \
  -H "Authorization: Bearer $SECRET" \
  http://cap-access-manager:3100/api/cron/site-health -o /dev/null -w '%{http_code}\n'
```
Expected: `200` (or `2xx`). Repeat with a wrong secret → expect `401`.

- [ ] **Step 3: Gate A (on a deploy-stack host, after re-pull + up):**
  1. `docker compose -f deploy/docker-compose.prod.yml up -d` starts `access-cron`.
  2. `docker logs access-cron` shows `cron: site-health ok` within ~20 s, plus the daily lines once at start.
  3. `docker kill access-cron && docker compose … up -d access-cron` → it comes back (self-heal).
  4. On a host that previously ran the old `setup.sh`: re-running `setup.sh` prints "Removed the legacy host-crontab jobs" and `crontab -l` no longer contains the managed block.

---

## Notes for the implementer

- The sidecar is deliberately host-agnostic — no host cron, no public round-trip; it talks to `access-manager:3100` on the default compose network.
- The daily batch runs once at container start too (retention is idempotent; audit-anchor is a no-op unless External anchor is enabled) — that's intended, not a bug.
- Deploy: **v0.56.0, tag-only** — no image behaviour changes, but tagging rebuilds the images and gives self-hosters a release note. Push `deploy/` + docs to main, `git tag v0.56.0 && git push origin v0.56.0`, watch `publish.yml`, then `gh release edit v0.56.0` with an English note: cron now runs automatically in-stack; self-hosters re-pull the `deploy/` folder and `docker compose -f deploy/docker-compose.prod.yml up -d`; the legacy host crontab is cleaned up on the next `setup.sh` run.
- There is **no manager redeploy** for this item (no app code changed); the user's own production stack is separate and out of scope.
```
