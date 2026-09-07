// RLS cross-tenant isolation integration test. Proves the tenant_isolation
// policies actually isolate under the non-owner `app` role (the dormant safety
// net that Phase 2 activates). Requires a live Postgres via TEST_DATABASE_URL
// (an owner connection to a database with the Prisma schema already pushed);
// SKIPPED otherwise, so the pure-unit suite/CI is unaffected.
//
// Run locally:
//   createdb + `DATABASE_URL=… npx prisma db push`, then
//   TEST_DATABASE_URL=… npx vitest run src/lib/tenant/rls.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const URL = process.env.TEST_DATABASE_URL;
const APP_PW = "rls_test_pw";

// Representative tables spanning the tenancy shapes.
const TABLES = ["Site", "User", "AuditEvent", "PlatformSettings", "Tenant"];

let db: PrismaClient;

async function asApp<T>(tenant: string | null, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE app");
    // null tenant = no context set (fail-closed expectation)
    if (tenant !== null) await tx.$executeRawUnsafe("SELECT set_config('app.current_tenant', $1, true)", tenant);
    return fn(tx as unknown as PrismaClient);
  });
}

describe.skipIf(!URL)("RLS cross-tenant isolation", () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) });
    // app role + grants
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN PASSWORD '${APP_PW}'; END IF; END $$`);
    await db.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO app");
    await db.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app");
    // RLS + policy on the test tables (Tenant keyed by id, others by tenantId)
    for (const t of TABLES) {
      const col = t === "Tenant" ? "id" : "tenantId";
      await db.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await db.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${t}"`);
      await db.$executeRawUnsafe(
        `CREATE POLICY tenant_isolation ON "${t}" USING ("${col}" = current_setting('app.current_tenant', true)) WITH CHECK ("${col}" = current_setting('app.current_tenant', true))`,
      );
    }
    // seed two tenants with a connector + site + user each (as owner, bypassing RLS)
    await db.$executeRawUnsafe(`INSERT INTO "Tenant"(id,slug,name) VALUES ('tenA','rls-a','A'),('tenB','rls-b','B') ON CONFLICT (id) DO NOTHING`);
    await db.$executeRawUnsafe(`INSERT INTO "Connector"(id,"tenantId",name,"tokenHash",status,"createdAt") VALUES ('rcA','tenA','cA','rlshA','ONLINE',now()),('rcB','tenB','cB','rlshB','ONLINE',now()) ON CONFLICT (id) DO NOTHING`);
    await db.$executeRawUnsafe(`INSERT INTO "Site"(id,"tenantId","connectorId",name,"accessMode","createdAt") VALUES ('rsA','tenA','rcA','SA','TRANSPARENT',now()),('rsB','tenB','rcB','SB','TRANSPARENT',now()) ON CONFLICT (id) DO NOTHING`);
  });

  afterAll(async () => {
    if (!db) return;
    await db.$executeRawUnsafe(`DELETE FROM "Site" WHERE id IN ('rsA','rsB')`);
    await db.$executeRawUnsafe(`DELETE FROM "Connector" WHERE id IN ('rcA','rcB')`);
    await db.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ('tenA','tenB')`);
    await db.$disconnect();
  });

  it("under tenant A, only A's sites are visible", async () => {
    const rows = await asApp("tenA", (tx) => tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Site" WHERE id IN ('rsA','rsB') ORDER BY id`));
    expect(rows.map((r) => r.id)).toEqual(["rsA"]);
  });

  it("under tenant B, only B's sites are visible", async () => {
    const rows = await asApp("tenB", (tx) => tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Site" WHERE id IN ('rsA','rsB') ORDER BY id`));
    expect(rows.map((r) => r.id)).toEqual(["rsB"]);
  });

  it("with no tenant context, nothing is visible (fail-closed)", async () => {
    const rows = await asApp(null, (tx) => tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Site" WHERE id IN ('rsA','rsB')`));
    expect(rows).toEqual([]);
  });

  it("cannot update another tenant's row", async () => {
    const affected = await asApp("tenA", (tx) => tx.$executeRawUnsafe(`UPDATE "Site" SET name='hacked' WHERE id='rsB'`));
    expect(affected).toBe(0);
    // confirm B's row is intact (as owner)
    const b = await db.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM "Site" WHERE id='rsB'`);
    expect(b[0].name).toBe("SB");
  });

  it("WITH CHECK blocks inserting a row for another tenant", async () => {
    await expect(
      asApp("tenA", (tx) => tx.$executeRawUnsafe(`INSERT INTO "Site"(id,"tenantId","connectorId",name,"accessMode","createdAt") VALUES ('rsX','tenB','rcB','X','TRANSPARENT',now())`)),
    ).rejects.toThrow();
  });

  it("every RLS-protected table has row security enabled", async () => {
    const rows = await db.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT relname FROM pg_class WHERE relrowsecurity AND relname = ANY($1)`,
      TABLES,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
  });
});
