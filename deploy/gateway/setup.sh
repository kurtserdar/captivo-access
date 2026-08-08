#!/usr/bin/env sh
# Captivo Access — one-command Guacamole gateway setup.
#
# Run this in deploy/gateway/ on the connector host:
#   ./setup.sh
# Idempotent: re-running is safe (schema + password are generated once).

set -eu
cd "$(dirname "$0")"

GUAC_IMAGE="guacamole/guacamole:1.5.5"
COMPOSE="docker-compose.gateway.yml"
NETWORK="captivo-access-gateway_default"

# 1. Guacamole DB schema — generated once, version-matched to the image.
if [ ! -f initdb/01-schema.sql ]; then
  echo "→ Generating the Guacamole DB schema..."
  mkdir -p initdb
  docker run --rm "$GUAC_IMAGE" /opt/guacamole/bin/initdb.sh --postgresql > initdb/01-schema.sql
fi

# 2. DB password — generated once into .env.
if [ ! -f .env ]; then
  echo "→ Generating a random DB password into .env ..."
  echo "GUAC_DB_PASSWORD=$(openssl rand -hex 32)" > .env
fi

# 3. Bring the stack up.
echo "→ Starting the gateway (guacd + guacamole + postgres)..."
docker compose -f "$COMPOSE" up -d

# Resolve the host admin port for the message below (GUAC_PORT in .env, else 8080).
PORT="$( . ./.env 2>/dev/null || true; echo "${GUAC_PORT:-8080}" )"

# 4. Attach a running connector on this host to the gateway network, if present.
if docker inspect access-connector >/dev/null 2>&1; then
  docker network connect "$NETWORK" access-connector 2>/dev/null \
    && echo "→ Attached container 'access-connector' to the gateway network." \
    || echo "→ 'access-connector' is already on the gateway network."
  CONNECTOR_NOTE="Your 'access-connector' is on the gateway network — nothing to do."
else
  CONNECTOR_NOTE="No 'access-connector' container here. When you pair one, add
     --network $NETWORK to its 'docker run' (or run: docker network connect $NETWORK <connector-name>)."
fi

cat <<EOF

✅ Gateway is up. Guacamole is served at the root path (/).

Next steps (these need your decisions, so they stay manual):

1. Open  http://127.0.0.1:${PORT}/  → log in  guacadmin / guacadmin  →
   CHANGE that password (top-right → Settings → Preferences).

2. Connector: $CONNECTOR_NOTE

3. In Captivo → /admin/sites → Add site:
     Internal address : http://cap-guacamole:8080   (no path)
     Access mode      : Gateway
     Hostname         : e.g. console.access.<your-domain>
   Then grant a vendor access to that Site.

4. In Guacamole → Settings → Connections → New connection:
     pick RDP / SSH / VNC, set the target host + credentials, and enable
     Screen Recording (path: /var/lib/guacamole/recordings).

Recordings are written on THIS host and replayed in Guacamole → Settings → History.
See README.md for detail.
EOF
