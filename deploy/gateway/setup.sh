#!/usr/bin/env sh
# Captivo Access — one-command Guacamole gateway setup.
#
# Gateway only (attach an already-running connector if present):
#   ./setup.sh
#
# All-in-one gateway host (also pair + run the connector on the gateway network):
#   MANAGER_URL=https://manager.access.<domain> \
#   DATAPLANE_URL=wss://connect.access.<domain> \
#   ./setup.sh <PAIR_CODE>
#   (copy MANAGER_URL / DATAPLANE_URL / PAIR_CODE from the console's "Add connector".)
#
# Idempotent: re-running is safe (schema + password generated once; existing
# containers are reused).

set -eu
cd "$(dirname "$0")"

GUAC_IMAGE="guacamole/guacamole:1.5.5"
CONNECTOR_IMAGE="ghcr.io/kurtserdar/captivo-access-connector:latest"
COMPOSE="docker-compose.gateway.yml"
NETWORK="captivo-access-gateway_default"
PAIR_CODE="${1:-${PAIR_CODE:-}}"

# 1. Guacamole DB schema — generated once, version-matched to the image.
if [ ! -f initdb/01-schema.sql ]; then
  echo "→ Generating the Guacamole DB schema..."
  mkdir -p initdb
  docker run --rm "$GUAC_IMAGE" /opt/guacamole/bin/initdb.sh --postgresql > initdb/01-schema.sql
fi

# 2. DB password — ensure one exists in .env (generated once). Robust to an .env
# the operator pre-created just to set GUAC_PORT: append the password if missing.
touch .env
if ! grep -q '^GUAC_DB_PASSWORD=..*' .env; then
  echo "→ Generating a random DB password into .env ..."
  echo "GUAC_DB_PASSWORD=$(openssl rand -hex 32)" >> .env
fi

# 3. Bring the gateway stack up.
echo "→ Starting the gateway (guacd + guacamole + postgres)..."
docker compose -f "$COMPOSE" up -d

# Host admin port for the message below (GUAC_PORT in .env, else 8080).
PORT="$( . ./.env 2>/dev/null || true; echo "${GUAC_PORT:-8080}" )"

# 4. Connector — reuse an existing one, or pair a new one on the gateway network.
if docker inspect access-connector >/dev/null 2>&1; then
  docker network connect "$NETWORK" access-connector 2>/dev/null \
    && echo "→ Attached existing 'access-connector' to the gateway network." \
    || echo "→ 'access-connector' is already on the gateway network."
  CONNECTOR_NOTE="Your 'access-connector' is on the gateway network — nothing to do."
elif [ -n "$PAIR_CODE" ]; then
  : "${MANAGER_URL:?set MANAGER_URL=https://manager.access.<domain> (from the console pairing command)}"
  : "${DATAPLANE_URL:?set DATAPLANE_URL=wss://connect.access.<domain> (from the console pairing command)}"
  echo "→ Pairing + starting the connector on the gateway network..."
  docker run -d --name access-connector --restart unless-stopped \
    --network "$NETWORK" \
    -e MANAGER_URL="$MANAGER_URL" \
    -e DATAPLANE_URL="$DATAPLANE_URL" \
    -e PAIR_CODE="$PAIR_CODE" \
    -v access_connector_data:/data \
    "$CONNECTOR_IMAGE"
  CONNECTOR_NOTE="Connector paired + running on the gateway network. It should show Online in the console shortly."
else
  CONNECTOR_NOTE="No connector here yet. For an all-in-one gateway host, re-run with a pairing code:
       MANAGER_URL=... DATAPLANE_URL=... ./setup.sh <PAIR_CODE>
     (get all three from the console's 'Add connector'). Or pair one separately with
     --network $NETWORK on its 'docker run'."
fi

cat <<EOF

✅ Gateway is up. Guacamole is served at the root path (/).

Next steps:

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
