// Drives the auto-scope path of the cloud db proxy: with NO explicit
// withTenant, an unwrapped request-context db op resolves the tenant from the
// mocked request host (next/headers) and runs inside a per-op GUC-set mini-tx.
// Requires a live Postgres via TEST_DATABASE_URL (owner connection to a DB with
// the schema pushed); SKIPPED otherwise. Mirrors rls.withtenant.integration.test.ts's
// env setup (app role, RLS policies, insert trigger, resolver function), then
// sets MULTI_TENANT=on + APP_DATABASE_URL and dynamically imports @/lib/db so
// the module picks the app-role connection + auto-scoping proxy.
//
// MUST run in its own vitest process (it mutates process-wide env and the db
// module cache, and mocks next/headers) — CI runs it as a separate `vitest run`.
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

// Mock the request host that resolveRequestTenant reads via next/headers().
let mockHost = "";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-host", mockHost]]) as unknown as Headers,
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
describe.skipIf(!OWNER_URL)("auto-scope: unwrapped cloud db ops resolve tenant from request host", () => {
  let owner: PrismaClient;
  let db: any;
  let TenantScopeRequiredError: new (...a: unknown[]) => Error;

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
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION set_tenant_from_guc() RETURNS trigger AS $$ BEGIN IF current_setting('app.current_tenant', true) IS NOT NULL AND current_setting('app.current_tenant', true) <> '' AND NEW."tenantId" = 'default' THEN NEW."tenantId" := current_setting('app.current_tenant', true); END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_tenant_from_guc ON "Site"`);
    await owner.$executeRawUnsafe(`CREATE TRIGGER trg_tenant_from_guc BEFORE INSERT ON "Site" FOR EACH ROW EXECUTE FUNCTION set_tenant_from_guc()`);
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text) RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT id FROM "Tenant" WHERE slug = p_slug AND status = 'ACTIVE' $$`);
    await owner.$executeRawUnsafe(`REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC`);
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO app`);

    await owner.$executeRawUnsafe(`INSERT INTO "Tenant"(id,slug,name,status) VALUES('az','auto-a','AZ','ACTIVE'),('bz','auto-b','BZ','ACTIVE') ON CONFLICT(id) DO NOTHING`);
    await owner.$executeRawUnsafe(`INSERT INTO "Connector"(id,"tenantId",name,"tokenHash",status,"createdAt") VALUES('acA','az','cA','tha','ONLINE',now()),('acB','bz','cB','thb','ONLINE',now()) ON CONFLICT(id) DO NOTHING`);
    await owner.$executeRawUnsafe(`INSERT INTO "Site"(id,"tenantId","connectorId",name,"accessMode","createdAt") VALUES('asA','az','acA','SA','TRANSPARENT',now()),('asB','bz','acB','SB','TRANSPARENT',now()) ON CONFLICT(id) DO NOTHING`);

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    process.env.ACCESS_DOMAIN = "example.test";
    process.env.MANAGER_PUBLIC_URL = "https://manager.example.test";
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ db } = await import("@/lib/db"));
    ({ TenantScopeRequiredError } = await import("@/lib/tenant/ambient"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "Site" WHERE id IN ('asA','asB','asNew')`);
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE id IN ('acA','acB')`);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ('az','bz')`);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.ACCESS_DOMAIN;
    delete process.env.MANAGER_PUBLIC_URL;
  });

  const ids = { id: { in: ["asA", "asB", "asNew"] } };

  it("auto-scopes a model delegate read to the host az sees only az's site", async () => {
    mockHost = "auto-a.example.test";
    const r: any[] = await db.site.findMany({ where: ids, select: { id: true } });
    const seen = r.map((s: any) => s.id);
    expect(seen).toContain("asA");
    expect(seen).not.toContain("asB");
  });

  it("switching host to auto-b sees only bz's site", async () => {
    mockHost = "auto-b.example.test";
    const r: any[] = await db.site.findMany({ where: ids, select: { id: true } });
    expect(r.map((s: any) => s.id)).toEqual(["asB"]);
  });

  it("a create with no tenantId under host auto-a auto-stamps tenantId=az", async () => {
    mockHost = "auto-a.example.test";
    await db.site.create({ data: { id: "asNew", connectorId: "acA", name: "N", accessMode: "TRANSPARENT" } });
    const row = await owner.$queryRawUnsafe<{ tenantId: string }[]>(`SELECT "tenantId" FROM "Site" WHERE id='asNew'`);
    expect(row[0].tenantId).toBe("az");
  });

  it("an interactive db.$transaction is auto-scoped", async () => {
    mockHost = "auto-a.example.test";
    const r: any[] = await db.$transaction(async (tx: any) => tx.site.findMany({ where: ids, select: { id: true } }));
    const seen = r.map((s: any) => s.id);
    expect(seen).toContain("asA");
    expect(seen).not.toContain("asB");
  });

  it("an empty host rejects with TenantScopeRequiredError", async () => {
    mockHost = "";
    await expect(db.site.findMany({ where: ids, select: { id: true } })).rejects.toThrow(TenantScopeRequiredError);
  });
});
