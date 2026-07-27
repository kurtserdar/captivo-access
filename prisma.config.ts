// Prisma 7 config — the CLI (generate/db push/migrate) reads DATABASE_URL from here.
// Note: the PrismaClient runtime connection does NOT use this file — it is set up
// separately with @prisma/adapter-pg in src/lib/db.ts (see https://pris.ly/d/prisma7-client-config).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
