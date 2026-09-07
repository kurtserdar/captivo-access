// Proves host/slug → tenant resolution end-to-end: the SECURITY DEFINER
// functions (RLS-bypass) map slug/hostname → tenant id from the app role, and a
// query inside withTenant(resolved) is scoped to that tenant. Requires a live
// Postgres via TEST_DATABASE_URL (owner connection, schema pushed); SKIPPED
// otherwise. MUST run in its own vitest process (mutates process-wide env + the
// db module cache) — CI runs it as a separate `vitest run` invocation.
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
describe.skipIf(!OWNER_URL)("host/slug → tenant resolution (app role)", () => {
  let owner: PrismaClient;
  let resolveTenantBySlug: (s: string) => Promise<string | null>;
  let resolveTenantByHostname: (h: string) => Promise<string | null>;
  let withTenant: <T>(t: string, fn: () => Promise<T>) => Promise<T>;
  let db: any;

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
    // the SECURITY DEFINER resolvers (as in bootstrap.sql)
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text) RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT id FROM "Tenant" WHERE slug = p_slug AND status = 'ACTIVE' $$`);
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION resolve_tenant_by_hostname(p_host text) RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT "tenantId" FROM "Site" WHERE hostname = p_host LIMIT 1 $$`);
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO app`);
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION resolve_tenant_by_hostname(text) TO app`);
    // seed two tenants with slugs + a Site hostname each
    await owner.$executeRawUnsafe(`INSERT INTO "Tenant"(id,slug,name,status) VALUES('rid-a','res-a','A','ACTIVE'),('rid-b','res-b','B','ACTIVE') ON CONFLICT(id) DO NOTHING`);
    await owner.$executeRawUnsafe(`INSERT INTO "Connector"(id,"tenantId",name,"tokenHash",status,"createdAt") VALUES('rcA','rid-a','cA','rha','ONLINE',now()),('rcB','rid-b','cB','rhb','ONLINE',now()) ON CONFLICT(id) DO NOTHING`);
    await owner.$executeRawUnsafe(`INSERT INTO "Site"(id,"tenantId","connectorId",name,hostname,"accessMode","createdAt") VALUES('rsA','rid-a','rcA','SA','a.res.test','TRANSPARENT',now()),('rsB','rid-b','rcB','SB','b.res.test','TRANSPARENT',now()) ON CONFLICT(id) DO NOTHING`);

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ resolveTenantBySlug, resolveTenantByHostname } = await import("@/lib/tenant/resolve"));
    ({ withTenant } = await import("@/lib/tenant/scope"));
    ({ db } = await import("@/lib/db"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "Site" WHERE id IN ('rsA','rsB')`);
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE id IN ('rcA','rcB')`);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ('rid-a','rid-b')`);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
  });

  it("resolves a slug to its tenant id (RLS-bypass definer)", async () => {
    expect(await resolveTenantBySlug("res-a")).toBe("rid-a");
    expect(await resolveTenantBySlug("res-b")).toBe("rid-b");
  });

  it("returns null for an unknown slug", async () => {
    expect(await resolveTenantBySlug("nope")).toBeNull();
  });

  it("resolves a hostname to its tenant id", async () => {
    expect(await resolveTenantByHostname("a.res.test")).toBe("rid-a");
    expect(await resolveTenantByHostname("missing.test")).toBeNull();
  });

  it("a query inside withTenant(resolved) is scoped to that tenant", async () => {
    const tenantId = await resolveTenantBySlug("res-a");
    const rows: any[] = await withTenant(tenantId!, () => db.site.findMany({ where: { id: { in: ["rsA", "rsB"] } }, select: { id: true } }));
    const seen = rows.map((s: any) => s.id);
    expect(seen).toContain("rsA");
    expect(seen).not.toContain("rsB");
  });
});
