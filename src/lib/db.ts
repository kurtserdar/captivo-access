import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { fillTenant, whereTenant } from "@/lib/tenant/context";

// Prisma 7: schema.prisma no longer carries a datasource url — the client's
// runtime connection is set up via a driver adapter (see prisma.config.ts comment).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Fills tenantId into a create/upsert payload from the active tenant when the
// caller didn't set one. Only active when MULTI_TENANT is on — self-host relies
// on the column default ("default") and pays no extension cost. RLS enforcement
// (SET LOCAL app.current_tenant) is added in the Phase 0b hardening pass.
function withTenantInjection(base: PrismaClient): PrismaClient {
  return base.$extends({
    query: {
      $allModels: {
        create({ args, query }) {
          args.data = fillTenant(args.data);
          return query(args);
        },
        createMany({ args, query }) {
          args.data = (Array.isArray(args.data) ? args.data.map(fillTenant) : fillTenant(args.data)) as typeof args.data;
          return query(args);
        },
        upsert({ args, query }) {
          args.create = fillTenant(args.create);
          return query(args);
        },
        // Read/mutate operations that take a filterable `where` are tenant-scoped
        // at the ORM layer. (findUnique/update/delete by a unique key are not
        // filterable here; the DB RLS policies close that gap once activated in
        // Phase 2 — cuids are unguessable so the near-term gap is narrow.)
        findMany({ args, query }) { return query(whereTenant(args)); },
        findFirst({ args, query }) { return query(whereTenant(args)); },
        findFirstOrThrow({ args, query }) { return query(whereTenant(args)); },
        count({ args, query }) { return query(whereTenant(args)); },
        aggregate({ args, query }) { return query(whereTenant(args)); },
        groupBy({ args, query }) { return query(whereTenant(args)); },
        updateMany({ args, query }) { return query(whereTenant(args)); },
        deleteMany({ args, query }) { return query(whereTenant(args)); },
      },
    },
  }) as unknown as PrismaClient;
}

function createClient(): PrismaClient {
  const base = new PrismaClient({ adapter });
  return multiTenantEnabled() ? withTenantInjection(base) : base;
}

// Prevent HMR from reconnecting in dev (single singleton).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
