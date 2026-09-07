// Drives the REAL production mechanism (scope.ts withTenant + db.ts proxy) as the
// non-owner `app` role, proving RLS enforces end-to-end. Requires a live Postgres
// via TEST_DATABASE_URL (owner connection to a DB with the schema pushed);
// SKIPPED otherwise. Sets MULTI_TENANT=on + APP_DATABASE_URL then dynamically
// imports db/scope so the module picks the app-role connection + tenant proxy.
//
// MUST run in its own vitest process (it mutates process-wide env and the db
// module cache). CI runs it as a separate `vitest run` invocation.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_PW = "rls_test_pw";

function toAppUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "app";
  u.password = APP_PW;
  return u.toString();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describe.skipIf(!OWNER_URL)("RLS via real withTenant + db proxy (app role)", () => {
  let owner: PrismaClient;
  let db: any;
  let withTenant: <T>(t: string, fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });
    await owner.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN PASSWORD '${APP_PW}'; END IF; END $$`);
    await owner.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO app");
    await owner.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app");
    for (const [t, col] of [["Site", "tenantId"], ["Tenant", "id"], ["Connector", "tenantId"]] as const) {
      await owner.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${t}"`);
      await owner.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON "${t}" USING ("${col}" = current_setting('app.current_tenant', true)) WITH CHECK ("${col}" = current_setting('app.current_tenant', true))`);
    }
    // the write-side trigger (as in bootstrap.sql) — stamps tenantId from the GUC
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION set_tenant_from_guc() RETURNS trigger AS $$ BEGIN IF current_setting('app.current_tenant', true) IS NOT NULL AND current_setting('app.current_tenant', true) <> '' AND NEW."tenantId" = 'default' THEN NEW."tenantId" := current_setting('app.current_tenant', true); END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_tenant_from_guc ON "Site"`);
    await owner.$executeRawUnsafe(`CREATE TRIGGER trg_tenant_from_guc BEFORE INSERT ON "Site" FOR EACH ROW EXECUTE FUNCTION set_tenant_from_guc()`);
    await owner.$executeRawUnsafe(`INSERT INTO "Tenant"(id,slug,name) VALUES('tenA','wa-a','A'),('tenB','wa-b','B') ON CONFLICT(id) DO NOTHING`);
    await owner.$executeRawUnsafe(`INSERT INTO "Connector"(id,"tenantId",name,"tokenHash",status,"createdAt") VALUES('wcA','tenA','cA','wha','ONLINE',now()),('wcB','tenB','cB','whb','ONLINE',now()) ON CONFLICT(id) DO NOTHING`);
    await owner.$executeRawUnsafe(`INSERT INTO "Site"(id,"tenantId","connectorId",name,"accessMode","createdAt") VALUES('wsA','tenA','wcA','SA','TRANSPARENT',now()),('wsB','tenB','wcB','SB','TRANSPARENT',now()) ON CONFLICT(id) DO NOTHING`);

    // Load the real db/scope with the app role + flag on. Clear the cross-HMR
    // client cache first so db.ts builds a fresh app-role client (a prior test
    // file may have cached the owner client on globalThis).
    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ db } = await import("@/lib/db"));
    ({ withTenant } = await import("@/lib/tenant/scope"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "Site" WHERE id IN ('wsA','wsB','wsNew')`);
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE id IN ('wcA','wcB')`);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ('tenA','tenB')`);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
  });

  const ids = { id: { in: ["wsA", "wsB", "wsNew"] } };

  it("withTenant(A) sees A's sites and never B's", async () => {
    const r: any[] = await withTenant("tenA", () => db.site.findMany({ where: ids, select: { id: true } }));
    const seen = r.map((s: any) => s.id);
    expect(seen).toContain("wsA");
    expect(seen).not.toContain("wsB");
  });

  it("withTenant(B) sees only B's sites", async () => {
    const r: any[] = await withTenant("tenB", () => db.site.findMany({ where: ids, select: { id: true } }));
    expect(r.map((s: any) => s.id)).toEqual(["wsB"]);
  });

  it("a create under A lands tenantId A (insert trigger) and is accepted", async () => {
    await withTenant("tenA", () => db.site.create({ data: { id: "wsNew", connectorId: "wcA", name: "N", accessMode: "TRANSPARENT" } }));
    const row = await owner.$queryRawUnsafe<{ tenantId: string }[]>(`SELECT "tenantId" FROM "Site" WHERE id='wsNew'`);
    expect(row[0].tenantId).toBe("tenA");
  });

  it("WITH CHECK blocks a create for another tenant", async () => {
    await expect(
      withTenant("tenA", () => db.site.create({ data: { id: "wsX", tenantId: "tenB", connectorId: "wcB", name: "X", accessMode: "TRANSPARENT" } })),
    ).rejects.toThrow();
  });

  it("nested db.$transaction inside withTenant reuses the scope", async () => {
    const r: any[] = await withTenant("tenA", () =>
      db.$transaction(async (tx: any) => tx.site.findMany({ where: ids, select: { id: true } })),
    );
    const seen = r.map((s: any) => s.id);
    expect(seen).toContain("wsA");
    expect(seen).not.toContain("wsB");
  });
});
