# Custom Caddy image with an ACME DNS-01 provider plugin, for wildcard TLS
# across *.<ACCESS_DOMAIN>. The stock caddy:2-alpine ships with no DNS plugins,
# so the `tls { dns ... }` block in Caddyfile needs a build like this one.
#
# Pass your provider's caddy-dns module via the CADDY_DNS_MODULE build arg.
# Default is Cloudflare; for deSEC use github.com/caddy-dns/desec, etc.
# The full provider list is at https://github.com/caddy-dns.
#
# Easiest way to use it is the opt-in override compose file, which builds this
# automatically (no manual image edits):
#   docker compose -f docker-compose.prod.yml -f docker-compose.dns.override.yml up -d
# See deploy/README.md "Wildcard TLS".

ARG CADDY_VERSION=2

FROM caddy:${CADDY_VERSION}-builder AS builder
ARG CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare
RUN xcaddy build --with ${CADDY_DNS_MODULE}

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
