// Prisma 7 config — CLI (generate/db push/migrate) DATABASE_URL'i buradan okur.
// Not: PrismaClient çalışma zamanı bağlantısı bu dosyayı KULLANMAZ — src/lib/db.ts
// içinde @prisma/adapter-pg ile ayrıca kurulur (bkz. https://pris.ly/d/prisma7-client-config).
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
