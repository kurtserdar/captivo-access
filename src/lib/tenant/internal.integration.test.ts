// Proves withTenantFrom actually scopes a non-request handler end-to-end from
// the app role: resolveTenantBySite (a SECURITY DEFINER, RLS-bypass resolver)
// maps a seeded Site's id to its tenant, and a handler wrapped in
// withTenantFrom(resolve) sees only that tenant's rows once MULTI_TENANT is
// on. Requires a live Postgres via TEST_DATABASE_URL (owner connection,
// schema pushed, bootstrap.sql applied, `app` role present); SKIPPED
// otherwise. MUST run in its own vitest process (mutates process-wide env +
// the db module cache) — mirrors resolve.integration.test.ts's env setup.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const OWNER_URL = process.env.TEST_DATABASE_URL;

function toAppUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "app";
  u.password = "rls_test_pw";
  return u.toString();
}

const suffix = crypto.randomUUID().slice(0, 8);
const tenantA = { id: `wtf-a-${suffix}`, slug: `wtf-a-${suffix}` };
const tenantB = { id: `wtf-b-${suffix}`, slug: `wtf-b-${suffix}` };
const connectorA = `wtfc-a-${suffix}`;
const connectorB = `wtfc-b-${suffix}`;
const siteA = `wtfs-a-${suffix}`;
const siteB = `wtfs-b-${suffix}`;

describe.skipIf(!OWNER_URL)("withTenantFrom scopes a non-request handler (app role)", () => {
  let owner: PrismaClient;
  let withTenantFrom: typeof import("./internal").withTenantFrom;
  let resolveTenantBySite: typeof import("./internal").resolveTenantBySite;
  let db: typeof import("@/lib/db").db;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'WTF Test A','ACTIVE'),($3,$4,'WTF Test B','ACTIVE')`,
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

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ withTenantFrom, resolveTenantBySite } = await import("./internal"));
    ({ db } = await import("@/lib/db"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "Site" WHERE id IN ($1,$2)`, siteA, siteB);
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE id IN ($1,$2)`, connectorA, connectorB);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
  });

  it("a handler wrapped in withTenantFrom(resolveTenantBySite) sees only that tenant's rows", async () => {
    const handler = async (_siteId: string) =>
      Response.json({ count: await db.site.count({ where: { id: { in: [siteA, siteB] } } }) });

    const wrapped = withTenantFrom((siteId: string) => resolveTenantBySite(siteId))(handler);
    const res = await wrapped(siteA);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);
  });

  it("an unresolvable key 404s as unknown_tenant without running the handler", async () => {
    const handler = vi.fn(async () => new Response("should not run"));
    const wrapped = withTenantFrom((siteId: string) => resolveTenantBySite(siteId))(handler);
    const res = await wrapped("nope-site");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_tenant" });
    expect(handler).not.toHaveBeenCalled();
  });
});
