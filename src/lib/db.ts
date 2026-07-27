import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7: schema.prisma no longer carries a datasource url — the client's
// runtime connection is set up via a driver adapter (see prisma.config.ts comment).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Prevent HMR from reconnecting in dev (single singleton).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
