import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7: schema.prisma artık datasource url taşımıyor — client çalışma
// zamanı bağlantısı driver adapter ile kuruluyor (bkz. prisma.config.ts yorumu).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Dev'de HMR yeniden bağlanmasını önle (tek singleton).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
