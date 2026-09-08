// Functional proof that Task 4's route wrapping is what makes the OIDC login
// path read the REQUEST tenant's SSO config in multi-tenant mode. The db
// proxy's per-op auto-scope sets the Postgres GUC from the request host, but
// `currentTenantId()` (the ALS scope) stays "default" unless something entered
// withTenant/withTenantRoute. getOidcConfig() keys its lookup off
// `currentTenantId()`, so a bare (unwrapped) call would read the "default"
// sentinel row (null here) and the tenant's SSO button/redirect would never
// work. With `withTenantRoute` wrapping GET, `currentTenantId()` is tenant A
// throughout the request, so oidc/start reads tenant A's issuer + clientId and
// redirects the browser to A's IdP — while a `withTenant(DEFAULT_TENANT, …)`
// read stays null (nothing leaked to the sentinel).
//
// Requires a live Postgres via TEST_DATABASE_URL (owner connection, schema
// pushed, bootstrap.sql applied, `app` role present); SKIPPED otherwise.
// Mirrors smtp/route.scope.integration.test.ts (app role, RLS policy, resolver
// function, mocked next/headers) — plus a cookie stub (oidc/start writes the
// ca_oidc state cookie) and a stubbed `discover` (no network to the IdP).
//
// MUST run in its own vitest process (mutates process-wide env + the db module
// cache, and mocks next/headers + @/lib/auth/oidc) — CI runs it as a separate
// `vitest run`.
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
const tenantA = { id: `oidc-a-${suffix}`, slug: `oidc-a-${suffix}` };
const AUTH_ENDPOINT = "https://idp-a.test/authorize";

// Mock the request host that resolveRequestTenant reads via next/headers(), and
// stand in a minimal cookie store (oidc/start persists the ca_oidc state cookie
// via cookies().set()).
let mockHost = "";
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-host", mockHost]]) as unknown as Headers,
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: () => {},
  }),
}));

// The IdP discovery is a network call — stub it so the test is deterministic and
// offline. randomUrlSafe/codeChallengeS256 stay real (pure).
vi.mock("@/lib/auth/oidc", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/oidc")>();
  return {
    ...actual,
    discover: async () => ({
      issuer: "https://idp-a.test",
      authorization_endpoint: AUTH_ENDPOINT,
      token_endpoint: "https://idp-a.test/token",
      jwks_uri: "https://idp-a.test/jwks",
    }),
  };
});

function startReq(host: string): NextRequest {
  const url = `https://${host}/api/auth/oidc/start`;
  const req = new Request(url, { method: "GET" });
  // oidc/start reads req.nextUrl.searchParams — a plain Request has no nextUrl.
  Object.defineProperty(req, "nextUrl", { value: new URL(url) });
  return req as unknown as NextRequest;
}

describe.skipIf(!OWNER_URL)("/api/auth/oidc/start GET is scoped to the request tenant", () => {
  let owner: PrismaClient;
  let GET: (req: NextRequest) => Promise<Response>;
  let db: typeof import("@/lib/db")["db"];
  let withTenant: <T>(t: string, fn: () => Promise<T>) => Promise<T>;
  let getOidcConfig: typeof import("@/lib/auth/oidc-config")["getOidcConfig"];
  let DEFAULT_TENANT: string;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN PASSWORD '${APP_PW}'; END IF; END $$`);
    await owner.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO app");
    await owner.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app");
    for (const [t, col] of [["Tenant", "id"], ["OidcConfig", "tenantId"]] as const) {
      await owner.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${t}"`);
      await owner.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON "${t}" USING ("${col}" = current_setting('app.current_tenant', true)) WITH CHECK ("${col}" = current_setting('app.current_tenant', true))`);
    }
    await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text) RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$ SELECT id FROM "Tenant" WHERE slug = p_slug AND status = 'ACTIVE' $$`);
    await owner.$executeRawUnsafe(`REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC`);
    await owner.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO app`);

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'OIDC Scope Test A','ACTIVE')`,
      tenantA.id, tenantA.slug,
    );
    // Tenant A has SSO enabled; the "default" sentinel has NO OidcConfig row.
    await owner.$executeRawUnsafe(
      `INSERT INTO "OidcConfig"("tenantId",enabled,issuer,"clientId","clientSecret","buttonLabel","createdAt","updatedAt")
       VALUES($1,true,'https://idp-a.test','client-A','','Sign in with A',now(),now())`,
      tenantA.id,
    );

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    process.env.ACCESS_DOMAIN = "example.test";
    process.env.MANAGER_PUBLIC_URL = "https://manager.example.test";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.SESSION_SECRET = "test-session-secret-for-oidc-state";
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ GET } = await import("@/app/api/auth/oidc/start/route"));
    ({ db } = await import("@/lib/db"));
    ({ withTenant } = await import("@/lib/tenant/scope"));
    ({ getOidcConfig } = await import("@/lib/auth/oidc-config"));
    ({ DEFAULT_TENANT } = await import("@/lib/tenant/context"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "OidcConfig" WHERE "tenantId" IN ($1,$2)`, tenantA.id, DEFAULT_TENANT);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id = $1`, tenantA.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.ACCESS_DOMAIN;
    delete process.env.MANAGER_PUBLIC_URL;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;
  });

  it("reads tenant A's OIDC config on A's host and redirects to A's IdP; nothing at the default sentinel", async () => {
    mockHost = `${tenantA.slug}.example.test`;

    const res = await GET(startReq(mockHost));
    // A configured, enabled tenant → redirect to the IdP authorization endpoint
    // carrying THAT tenant's clientId. A bare (unscoped) handler would read the
    // "default" sentinel (no row → null) and instead redirect to /login.
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith(AUTH_ENDPOINT)).toBe(true);
    expect(new URL(loc).searchParams.get("client_id")).toBe("client-A");

    // The same read from the default sentinel scope is null — nothing leaked.
    const atDefault = await withTenant(DEFAULT_TENANT, () => getOidcConfig());
    expect(atDefault).toBeNull();

    // And under tenant A's scope the read resolves A's enabled config.
    const atA = await withTenant(tenantA.id, () => getOidcConfig());
    expect(atA?.enabled).toBe(true);
    expect(atA?.clientId).toBe("client-A");
  });
});
