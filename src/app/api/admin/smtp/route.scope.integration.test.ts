// Functional proof that Task 2's route wrapping is what makes /api/admin/smtp
// POST correct under multi-tenant mode. Before wrapping: the db proxy's
// per-op auto-scope (db.ts, driven by the mocked request host) sets the
// Postgres GUC to tenant A for each write, so the SmtpConfig row lands under
// tenant A via the insert trigger — but the handler's own reads/writes key off
// `currentTenantId()` (the ALS scope), which stays "default" unless something
// entered withTenant/withTenantRoute. So a bare handler call would upsert
// `where: { tenantId: "default" }` while the GUC stamps the row's actual
// tenantId as A: a corrupted, cross-scope row. With `withTenantRoute` wrapping
// the handler, `currentTenantId()` is tenant A throughout the request, so the
// row is written and keyed consistently under tenant A, and nothing lands
// under the "default" sentinel.
//
// Requires a live Postgres via TEST_DATABASE_URL (owner connection, schema
// pushed, bootstrap.sql applied, `app` role present); SKIPPED otherwise.
// Mirrors autoscope.integration.test.ts's env setup (app role, RLS policy,
// resolver function, mocked next/headers) plus
// insights.scope.integration.test.ts's use of the real withTenant/db and
// mocked next/headers.
//
// MUST run in its own vitest process (mutates process-wide env + the db module
// cache, and mocks next/headers + @/lib/current-user) — CI runs it as a
// separate `vitest run`.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_PW = "rls_test_pw";

function toAppUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "app";
  u.password = APP_PW;
  return u.toString();
}

const suffix = crypto.randomUUID().slice(0, 8);
const tenantA = { id: `smtp-a-${suffix}`, slug: `smtp-a-${suffix}` };
const adminUser = { id: `smtp-admin-${suffix}`, email: "admin@a.test", role: "ADMIN" as const };

// Mock the request host that resolveRequestTenant reads via next/headers().
let mockHost = "";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-host", mockHost]]) as unknown as Headers,
}));

// Auth is not what this test is about — bypass the session/cookie machinery
// and stand in a fixed admin user with the "configure" capability.
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async () => adminUser,
}));

function smtpPostReq(body: Record<string, unknown>): NextRequest {
  return new Request("http://tenant/api/admin/smtp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe.skipIf(!OWNER_URL)("/api/admin/smtp POST is scoped to the request tenant", () => {
  let owner: PrismaClient;
  let POST: (req: NextRequest) => Promise<Response>;
  let db: typeof import("@/lib/db")["db"];
  let withTenant: <T>(t: string, fn: () => Promise<T>) => Promise<T>;
  let DEFAULT_TENANT: string;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN PASSWORD '${APP_PW}'; END IF; END $$`);
    await owner.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO app");
    await owner.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app");
    for (const [t, col] of [["Tenant", "id"], ["SmtpConfig", "tenantId"]] as const) {
      await owner.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${t}"`);
      await owner.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON "${t}" USING ("${col}" = current_setting('app.current_tenant', true)) WITH CHECK ("${col}" = current_setting('app.current_tenant', true))`);
    }
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text) RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT id FROM "Tenant" WHERE slug = p_slug AND status = 'ACTIVE' $$`);
    await owner.$executeRawUnsafe(`REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC`);
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO app`);

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'SMTP Scope Test A','ACTIVE')`,
      tenantA.id, tenantA.slug,
    );

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    process.env.ACCESS_DOMAIN = "example.test";
    process.env.MANAGER_PUBLIC_URL = "https://manager.example.test";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ POST } = await import("@/app/api/admin/smtp/route"));
    ({ db } = await import("@/lib/db"));
    ({ withTenant } = await import("@/lib/tenant/scope"));
    ({ DEFAULT_TENANT } = await import("@/lib/tenant/context"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "SmtpConfig" WHERE "tenantId" IN ($1,$2)`, tenantA.id, DEFAULT_TENANT);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id = $1`, tenantA.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.ACCESS_DOMAIN;
    delete process.env.MANAGER_PUBLIC_URL;
    delete process.env.ENCRYPTION_KEY;
  });

  it("saves the SMTP config under the request tenant, and nothing leaks to the default sentinel", async () => {
    mockHost = `${tenantA.slug}.example.test`;

    const res = await POST(
      smtpPostReq({ host: "smtp.a.test", port: 587, fromEmail: "a@a.test", password: "pw", enabled: true }),
    );
    expect(res.status).toBe(200);

    // Read back in a fresh request scope, exactly as a subsequent request
    // (or the console's own GET) would.
    const saved = await withTenant(tenantA.id, () => db.smtpConfig.findUnique({ where: { tenantId: tenantA.id } }));
    expect(saved?.host).toBe("smtp.a.test");
    expect(saved?.fromEmail).toBe("a@a.test");
    expect(saved?.enabled).toBe(true);

    const none = await withTenant(DEFAULT_TENANT, () => db.smtpConfig.findUnique({ where: { tenantId: DEFAULT_TENANT } }));
    expect(none).toBeNull();
  });
});
