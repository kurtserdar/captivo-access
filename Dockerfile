# ---- deps ----
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder ----
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm db:generate && pnpm build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ARG VERSION=dev
ENV APP_VERSION=$VERSION
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js standalone output. Owned by the built-in unprivileged `node` user
# (UID 1000, present in node:alpine) so the app runs non-root. Safe here: the
# app never writes to the filesystem at runtime — logos/uploads are DB Bytes.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# PRISMA 7 NOTE: the generated client is NOT in node_modules → it's in src/generated/prisma
# (Task 3). In Slice 0 no route imports db.ts → it never enters the standalone bundle,
# so no manual COPY is needed. The builder stage already ran `db:generate` (client
# generated into src/generated); once db.ts is imported in Slice 1, Next's file tracing
# will pull it into the standalone bundle automatically. The old `COPY node_modules/.prisma`
# lines were WRONG under Prisma 7 and have been removed.
EXPOSE 3100
ENV PORT=3100
USER node
CMD ["node", "server.js"]
