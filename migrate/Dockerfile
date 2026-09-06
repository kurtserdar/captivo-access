# One-shot schema-migration image. Seeds the default tenant (prisma/rls/pre-push.sql
# via psql) then runs `prisma db push` against DATABASE_URL and exits — the compose
# stack runs it before the Manager starts. Prisma 7 needs node >=22, and the schema's
# datasource URL comes from prisma.config.ts (which imports dotenv + prisma/config),
# so both the CLI and those deps must be present — a bare `npx prisma` cannot resolve
# them. postgresql-client provides psql for the pre-push seed.
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache postgresql-client
RUN npm init -y >/dev/null && npm install prisma@7 dotenv
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY migrate/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
# DATABASE_URL is supplied by the container environment (read via prisma.config.ts).
# db push is idempotent + additive-safe; without --accept-data-loss a destructive
# diff is refused, so the container exits non-zero rather than dropping data.
CMD ["./entrypoint.sh"]
