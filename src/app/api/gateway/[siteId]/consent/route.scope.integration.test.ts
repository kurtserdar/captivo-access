// Functional proof that Task 3's route wrapping is what makes the gateway
// consent POST correct under multi-tenant mode. The consent handler drives
// appendAuditEvents(), whose chain key (chainKey("access"), see chain-key.ts)
// is built from currentTenantId() — the ALS scope, not the db proxy's per-op
// host-derived GUC. Unwrapped, currentTenantId() stays "default" across the
// whole request: the first append's upsert creates the chain head keyed
// {tenantId:"default", scope:"access"} (the BEFORE INSERT trigger then stamps
// the row's actual tenantId from the GUC, i.e. tenant A) — but the SECOND
// append's upsert still looks up {tenantId:"default", scope:"access"}, misses
// the row it just wrote (its real tenantId is now A, not "default"), and
// re-attempts a create that collides with the existing (tenantId=A, scope)
// primary key. The handler swallows that error in a try/catch and still
// returns 200 — so this proof does NOT trust the response status; it asserts
// on the chain state / event rows directly.
//
// Requires a live Postgres via TEST_DATABASE_URL (owner connection, schema
// pushed, bootstrap.sql applied, `app` role present); SKIPPED otherwise.
// Mirrors admin/smtp's route.scope.integration.test.ts harness (app role, RLS
// policy, resolver function, mocked next/headers + current-user).
//
// MUST run in its own vitest process (mutates process-wide env + the db module
// cache, and mocks next/headers + @/lib/current-user) — CI runs it as a
// separate `vitest run`.
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
const tenantA = { id: `consent-a-${suffix}`, slug: `consent-a-${suffix}` };
const tenantB = { id: `consent-b-${suffix}`, slug: `consent-b-${suffix}` };
const connectorA = { id: `consent-conn-a-${suffix}` };
const siteA = { id: `consent-site-a-${suffix}` };
const vendorUser = { id: `consent-user-${suffix}`, email: "vendor@a.test", role: "VENDOR" as const };

// Mock the request host that resolveRequestTenant reads via next/headers().
let mockHost = "";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-host", mockHost]]) as unknown as Headers,
}));

// Auth is not what this test is about — bypass the session/cookie machinery
// and stand in a fixed vendor user.
vi.mock("@/lib/current-user", () => ({
  requireUser: async () => vendorUser,
}));

function consentReq(): Request {
  return new Request("http://tenant/api/gateway/site/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

describe.skipIf(!OWNER_URL)("/api/gateway/[siteId]/consent POST is scoped to the request tenant", () => {
  let owner: PrismaClient;
  let POST: (req: Request, ctx: { params: Promise<{ siteId: string }> }) => Promise<Response>;
  let db: typeof import("@/lib/db")["db"];
  let withTenant: <T>(t: string, fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN PASSWORD '${APP_PW}'; END IF; END $$`);
    await owner.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO app");
    await owner.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app");
    for (const [t, col] of [
      ["Tenant", "id"],
      ["Connector", "tenantId"],
      ["Site", "tenantId"],
      ["AuditEvent", "tenantId"],
      ["AuditChainState", "tenantId"],
      ["SmtpConfig", "tenantId"],
    ] as const) {
      await owner.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${t}"`);
      await owner.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON "${t}" USING ("${col}" = current_setting('app.current_tenant', true)) WITH CHECK ("${col}" = current_setting('app.current_tenant', true))`);
    }
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text) RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT id FROM "Tenant" WHERE slug = p_slug AND status = 'ACTIVE' $$`);
    await owner.$executeRawUnsafe(`REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC`);
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO app`);

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'Consent Scope Test A','ACTIVE'),($3,$4,'Consent Scope Test B','ACTIVE')`,
      tenantA.id, tenantA.slug, tenantB.id, tenantB.slug,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "Connector"(id,"tenantId",name,"tokenHash",status) VALUES($1,$2,'Consent Test Connector','th','PENDING')`,
      connectorA.id, tenantA.id,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "Site"(id,"tenantId","connectorId",name,"accessMode") VALUES($1,$2,$3,'Consent Test Site','GATEWAY')`,
      siteA.id, tenantA.id, connectorA.id,
    );

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    process.env.ACCESS_DOMAIN = "example.test";
    process.env.MANAGER_PUBLIC_URL = "https://manager.example.test";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ POST } = await import("@/app/api/gateway/[siteId]/consent/route"));
    ({ db } = await import("@/lib/db"));
    ({ withTenant } = await import("@/lib/tenant/scope"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "AuditChainState" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "Site" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.ACCESS_DOMAIN;
    delete process.env.MANAGER_PUBLIC_URL;
    delete process.env.ENCRYPTION_KEY;
  });

  it("two consent POSTs both succeed and link into a single intact chain head for tenant A", async () => {
    mockHost = `${tenantA.slug}.example.test`;

    const res1 = await POST(consentReq(), { params: Promise.resolve({ siteId: siteA.id }) });
    const res2 = await POST(consentReq(), { params: Promise.resolve({ siteId: siteA.id }) });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const heads = await withTenant(tenantA.id, () => db.auditChainState.findMany({ where: { scope: "access" } }));
    expect(heads).toHaveLength(1);
    expect(heads[0].tenantId).toBe(tenantA.id); // not "default"
    expect(heads[0].lastSeq).toBe(BigInt(2));

    const events = await withTenant(tenantA.id, () => db.auditEvent.count({ where: { decision: "ALLOW" } }));
    expect(events).toBeGreaterThanOrEqual(2);
  });

  it("tenant B sees none of tenant A's chain state or config — no cross-tenant bleed", async () => {
    const headsB = await withTenant(tenantB.id, () => db.auditChainState.findMany({ where: { scope: "access" } }));
    expect(headsB).toHaveLength(0);

    const eventsB = await withTenant(tenantB.id, () => db.auditEvent.count({ where: { decision: "ALLOW" } }));
    expect(eventsB).toBe(0);

    const smtpB = await withTenant(tenantB.id, () => db.smtpConfig.findMany({}));
    expect(smtpB).toHaveLength(0);
  });
});
