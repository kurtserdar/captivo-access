# One-shot schema-migration image. Its only job is to run `prisma db push`
# against DATABASE_URL and exit — the compose stack runs it before the Manager
# starts. Prisma 7 needs node >=22, and the schema's datasource URL comes from
# prisma.config.ts (which imports dotenv + prisma/config), so both the CLI and
# those deps must be present — a bare `npx prisma` cannot resolve them.
FROM node:22-alpine
WORKDIR /app
RUN npm init -y >/dev/null && npm install prisma@7 dotenv
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
# DATABASE_URL is supplied by the container environment (read via prisma.config.ts).
# db push is idempotent + additive-safe; without --accept-data-loss a destructive
# diff is refused, so the container exits non-zero rather than dropping data.
CMD ["./node_modules/.bin/prisma", "db", "push", "--schema=prisma/schema.prisma"]
