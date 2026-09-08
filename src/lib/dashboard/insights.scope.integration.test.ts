// Functional proof that Task 1's RSC wrapping is what makes getInsights()
// correct under multi-tenant mode. Drives the REAL production mechanism:
// the db proxy's per-op auto-scope (db.ts's inAutoScope, driven by the mocked
// request host) sets the Postgres GUC correctly, but getInsights() interpolates
// its own tenant filter from currentTenantId() (the ALS scope) — which stays
// "default" unless something entered withTenant/withRequestTenant. So:
//   - a "bare" call (host resolves to tenant A, but no withTenant/withRequestTenant
//     wraps it — the exact bug an unwrapped RSC page had before Task 1) filters
//     on tenantId='default' and sees none of tenant A's seeded events;
//   - a call wrapped in withTenant(tenantAId, ...) (what the wrapped page now
//     does) filters on tenantId=tenantA and sees them.
// This pins that the wrapping is load-bearing, not cosmetic.
//
// Requires a live Postgres via TEST_DATABASE_URL (owner connection, schema
// pushed); SKIPPED otherwise. Mirrors autoscope.integration.test.ts's env setup
// (app role, RLS policy, resolver function, mocked next/headers) plus
// rls.withtenant.integration.test.ts's use of the real withTenant/db.
//
// MUST run in its own vitest process (mutates process-wide env + the db module
// cache, and mocks next/headers) — CI runs it as a separate `vitest run`.
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

const suffix = crypto.randomUUID().slice(0, 8);
const tenantA = { id: `ins-a-${suffix}`, slug: `ins-a-${suffix}` };
const tenantB = { id: `ins-b-${suffix}`, slug: `ins-b-${suffix}` };

// Mock the request host that resolveRequestTenant reads via next/headers().
let mockHost = "";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-host", mockHost]]) as unknown as Headers,
}));

describe.skipIf(!OWNER_URL)("getInsights() is only correct under the request tenant's scope", () => {
  let owner: PrismaClient;
  let getInsights: typeof import("@/lib/dashboard/insights")["getInsights"];
  let withTenant: <T>(t: string, fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN PASSWORD '${APP_PW}'; END IF; END $$`);
    await owner.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO app");
    await owner.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app");
    for (const [t, col] of [["Tenant", "id"], ["AuditEvent", "tenantId"]] as const) {
      await owner.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${t}"`);
      await owner.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON "${t}" USING ("${col}" = current_setting('app.current_tenant', true)) WITH CHECK ("${col}" = current_setting('app.current_tenant', true))`);
    }
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text) RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT id FROM "Tenant" WHERE slug = p_slug AND status = 'ACTIVE' $$`);
    await owner.$executeRawUnsafe(`REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC`);
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO app`);

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'Insights Test A','ACTIVE'),($3,$4,'Insights Test B','ACTIVE')`,
      tenantA.id, tenantA.slug, tenantB.id, tenantB.slug,
    );
    // Two DENY events for tenant A (drives insights.deny.total), one for tenant B
    // (proves the assertion isn't just "any tenant's data leaked through").
    const now = new Date();
    await owner.$executeRawUnsafe(
      `INSERT INTO "AuditEvent"(id,"tenantId","timestamp",host,method,path,status,decision,reason,seq) VALUES
         ($1,$2,$3,'a.example.test','GET','/x',403,'DENY','policy',1),
         ($4,$2,$3,'a.example.test','GET','/y',403,'DENY','policy',2)`,
      `ae-a1-${suffix}`, tenantA.id, now, `ae-a2-${suffix}`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "AuditEvent"(id,"tenantId","timestamp",host,method,path,status,decision,reason,seq) VALUES ($1,$2,$3,'b.example.test','GET','/z',403,'DENY','policy',1)`,
      `ae-b1-${suffix}`, tenantB.id, now,
    );

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    process.env.ACCESS_DOMAIN = "example.test";
    process.env.MANAGER_PUBLIC_URL = "https://manager.example.test";
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ getInsights } = await import("@/lib/dashboard/insights"));
    ({ withTenant } = await import("@/lib/tenant/scope"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.ACCESS_DOMAIN;
    delete process.env.MANAGER_PUBLIC_URL;
  });

  it("a bare call (auto-scoped GUC, no ambient tenant) misses the tenant's own data", async () => {
    // The request host resolves to tenant A (the db proxy's auto-scope sets the
    // GUC to tenant A for each op), but nothing entered withTenant/withRequestTenant,
    // so currentTenantId() — what getInsights() filters on — is still "default".
    mockHost = `${tenantA.slug}.example.test`;
    const bare = await getInsights();
    expect(bare.deny.total).toBe(0);
  });

  it("withTenant(tenantA, ...) — what the wrapped page now does — sees tenant A's denies", async () => {
    const scoped = await withTenant(tenantA.id, () => getInsights());
    expect(scoped.deny.total).toBeGreaterThan(0);
    expect(scoped.deny.total).toBe(2);
  });

  it("withTenant(tenantB, ...) sees only tenant B's denies, not tenant A's", async () => {
    const scopedB = await withTenant(tenantB.id, () => getInsights());
    expect(scopedB.deny.total).toBe(1);
  });
});
