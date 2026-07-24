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
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next standalone çıktısı
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# PRISMA 7 NOTU: generated client node_modules'de DEĞİL → src/generated/prisma'da
# (Task 3). Slice 0'da hiçbir route db.ts'i import etmez → standalone'a girmez,
# manuel COPY GEREKMEZ. Builder stage'de `db:generate` çalıştı (client src/generated'da
# üretildi); Dilim 1'de db.ts import edilince Next file-tracing standalone'a otomatik
# dahil eder. Eski `COPY node_modules/.prisma` satırları Prisma 7'de YANLIŞTI, kaldırıldı.
EXPOSE 3100
ENV PORT=3100
CMD ["node", "server.js"]
