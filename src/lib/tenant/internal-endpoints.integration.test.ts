// Proves one of the payload-keyed internal/* endpoints (access/check) is
// actually tenant-scoped end-to-end through the real exported POST handler —
// not just the withTenantFrom/resolver composition (already covered generically
// in internal.integration.test.ts). Seeds two tenants, each with its own site,
// user, and ACTIVE access grant; calls the real route module's POST with
// MULTI_TENANT on and asserts:
//   - a user/site pair in the same tenant is granted access, and
//   - the same userId, when the resolved tenant (from siteId) doesn't own that
//     user row, is invisible under RLS (no cross-tenant leak) rather than
//     wrongly authorized.
// Requires a live Postgres via TEST_DATABASE_URL (owner connection, schema
// pushed, bootstrap.sql applied, `app` role present); SKIPPED otherwise. MUST
// run in its own vitest process (mutates process-wide env + the db module
// cache) — mirrors internal.integration.test.ts's env setup.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

const OWNER_URL = process.env.TEST_DATABASE_URL;

function toAppUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "app";
  u.password = "rls_test_pw";
  return u.toString();
}

const suffix = crypto.randomUUID().slice(0, 8);
const tenantA = { id: `iet-a-${suffix}`, slug: `iet-a-${suffix}` };
const tenantB = { id: `iet-b-${suffix}`, slug: `iet-b-${suffix}` };
const connectorA = `ietc-a-${suffix}`;
const connectorB = `ietc-b-${suffix}`;
const siteA = `iets-a-${suffix}`;
const siteB = `iets-b-${suffix}`;
const userA = `ietu-a-${suffix}`;
const userB = `ietu-b-${suffix}`;
const grantA = `ietg-a-${suffix}`;
const grantB = `ietg-b-${suffix}`;
const DP_SECRET = `iet-dp-secret-${suffix}`;

function checkReq(body: Record<string, unknown>): NextRequest {
  return new Request("http://internal/api/internal/access/check", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": DP_SECRET },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe.skipIf(!OWNER_URL)("internal/access/check is tenant-scoped via withTenantFrom (app role)", () => {
  let owner: PrismaClient;
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'IET Test A','ACTIVE'),($3,$4,'IET Test B','ACTIVE')`,
      tenantA.id, tenantA.slug, tenantB.id, tenantB.slug,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "Connector"(id,"tenantId",name,"tokenHash",status,"createdAt") VALUES
         ($1,$2,'Connector A','${suffix}-conn-a','ONLINE',now()),
         ($3,$4,'Connector B','${suffix}-conn-b','ONLINE',now())`,
      connectorA, tenantA.id, connectorB, tenantB.id,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "Site"(id,"tenantId","connectorId",name,"accessMode","createdAt") VALUES
         ($1,$2,$3,'Site A','TRANSPARENT',now()),
         ($4,$5,$6,'Site B','TRANSPARENT',now())`,
      siteA, tenantA.id, connectorA, siteB, tenantB.id, connectorB,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "User"(id,"tenantId",email,name,role,status,"createdAt") VALUES
         ($1,$2,'a@iet.test','User A','VENDOR','ACTIVE',now()),
         ($3,$4,'b@iet.test','User B','VENDOR','ACTIVE',now())`,
      userA, tenantA.id, userB, tenantB.id,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "AccessGrant"(id,"tenantId","userId","siteId",status,"requiresApproval","createdAt") VALUES
         ($1,$2,$3,$4,'ACTIVE',false,now()),
         ($5,$6,$7,$8,'ACTIVE',false,now())`,
      grantA, tenantA.id, userA, siteA, grantB, tenantB.id, userB, siteB,
    );

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    process.env.DATAPLANE_SECRET = DP_SECRET;
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ POST } = await import("@/app/api/internal/access/check/route"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "AccessGrant" WHERE id IN ($1,$2)`, grantA, grantB);
    await owner.$executeRawUnsafe(`DELETE FROM "User" WHERE id IN ($1,$2)`, userA, userB);
    await owner.$executeRawUnsafe(`DELETE FROM "Site" WHERE id IN ($1,$2)`, siteA, siteB);
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE id IN ($1,$2)`, connectorA, connectorB);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.DATAPLANE_SECRET;
  });

  it("grants access for a user+site pair that both live in the resolved (siteId's) tenant", async () => {
    const res = await POST(checkReq({ userId: userA, siteId: siteA }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allow: true, reason: "allow" });

    const resB = await POST(checkReq({ userId: userB, siteId: siteB }));
    expect(resB.status).toBe(200);
    expect(await resB.json()).toEqual({ allow: true, reason: "allow" });
  });

  it("does not leak a foreign tenant's user across the boundary: userA under siteB's (tenant B) scope is invisible", async () => {
    // siteId=siteB resolves the request to tenant B; userA only exists in
    // tenant A, so under tenant B's RLS scope db.user.findUnique(userA) sees
    // no row — evaluateAccess must treat that as user_disabled, never as an
    // authorized cross-tenant user.
    const res = await POST(checkReq({ userId: userA, siteId: siteB }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allow: false, reason: "user_disabled" });
  });

  it("an unresolvable siteId 404s as unknown_tenant, never reaching evaluateAccess", async () => {
    const res = await POST(checkReq({ userId: userA, siteId: "nope-site" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_tenant" });
  });
});
