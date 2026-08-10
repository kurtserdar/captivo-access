#!/usr/bin/env sh
# Captivo Access — one-command production setup.
# Brings up the whole stack (Manager + data-plane + Postgres + Caddy) from the
# published images.
#
#   ./setup.sh access.example.com
#   # or: ACCESS_DOMAIN=access.example.com ./setup.sh
#
# Point DNS FIRST — three names at this host's public IP, ports 80 + 443 open:
#   manager.<domain>   connect.<domain>   *.<domain>   (wildcard, per-site access)
#
# Idempotent: re-running reuses the existing .env (secrets are generated ONCE)
# and just re-applies `docker compose up -d`. Delete .env to regenerate.

set -eu
cd "$(dirname "$0")"

COMPOSE="docker-compose.prod.yml"
ACCESS_DOMAIN="${1:-${ACCESS_DOMAIN:-}}"

CRON_MARKER="# captivo-access cron (managed by setup.sh — do not edit this block)"

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

if [ ! -f .env ]; then
  if [ -z "$ACCESS_DOMAIN" ]; then
    printf "Access domain (e.g. access.example.com): "
    read -r ACCESS_DOMAIN
  fi
  [ -n "$ACCESS_DOMAIN" ] || { echo "ACCESS_DOMAIN is required." >&2; exit 1; }

  echo "→ Generating .env for $ACCESS_DOMAIN (secrets created once)..."
  cat > .env <<EOF
ACCESS_DOMAIN=$ACCESS_DOMAIN
COOKIE_DOMAIN=.$ACCESS_DOMAIN
MANAGER_PUBLIC_URL=https://manager.$ACCESS_DOMAIN
WEBAUTHN_RP_ID=$ACCESS_DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
DATAPLANE_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
AUDIT_RETENTION_DAYS=730
EOF
  chmod 600 .env
else
  echo "→ Reusing existing .env (delete it to regenerate)."
  ACCESS_DOMAIN="$( . ./.env 2>/dev/null || true; echo "${ACCESS_DOMAIN:-<your-domain>}" )"
fi

echo "→ Pulling images + starting the stack (manager + data-plane + postgres + Caddy)..."
docker compose -f "$COMPOSE" pull
docker compose -f "$COMPOSE" up -d

install_cron

cat <<EOF

✅ Captivo Access is starting.

DNS — point all three at this host's public IP (ports 80 + 443 open):
   manager.$ACCESS_DOMAIN
   connect.$ACCESS_DOMAIN
   *.$ACCESS_DOMAIN            (wildcard, for per-site vendor access)

Next steps:
1. Wait ~30s for Caddy to obtain certificates, then open:
     https://manager.$ACCESS_DOMAIN/
2. Complete first-run setup to create the initial admin (passkey).
3. Add a connector (/admin/connectors), a site (/admin/sites), then grant a vendor access.

Re-running ./setup.sh is safe — it reuses .env and re-applies the stack.
See README.md for the full reference, or ../docs/quickstart.md for a zero-DNS trial.
EOF
