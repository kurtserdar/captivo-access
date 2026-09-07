// Proves forEachTenant fans a cron job out across ACTIVE tenants, each
// invocation scoped by the REAL withTenant + db proxy (RLS enforced as the
// `app` role) — a job that counts rows sees only its own tenant's rows. Also
// proves the self-host path (MULTI_TENANT off): the job runs exactly once,
// unscoped. Requires a live Postgres via TEST_DATABASE_URL (owner connection,
// schema pushed, bootstrap.sql applied, `app` role present); SKIPPED
// otherwise. MUST run in its own vitest process (mutates process-wide env +
// the db module cache) — mirrors rls.withtenant.integration.test.ts.
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
const tenantA = { id: `fet-a-${suffix}`, slug: `fet-a-${suffix}` };
const tenantB = { id: `fet-b-${suffix}`, slug: `fet-b-${suffix}` };
const idsA = [`fet-ea1-${suffix}`, `fet-ea2-${suffix}`, `fet-ea3-${suffix}`];
const idsB = [`fet-eb1-${suffix}`, `fet-eb2-${suffix}`];
const allIds = [...idsA, ...idsB];

describe.skipIf(!OWNER_URL)("forEachTenant (app role)", () => {
  let owner: PrismaClient;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'FET Test A','ACTIVE'),($3,$4,'FET Test B','ACTIVE')`,
      tenantA.id, tenantA.slug, tenantB.id, tenantB.slug,
    );

    let seq = 1;
    for (const id of idsA) {
      await owner.$executeRawUnsafe(
        `INSERT INTO "AuditEvent"(id,"tenantId",host,method,path,status,decision,seq) VALUES($1,$2,'manager','GET','/x',200,'ALLOW',$3)`,
        id, tenantA.id, seq++,
      );
    }
    seq = 1;
    for (const id of idsB) {
      await owner.$executeRawUnsafe(
        `INSERT INTO "AuditEvent"(id,"tenantId",host,method,path,status,decision,seq) VALUES($1,$2,'manager','GET','/x',200,'ALLOW',$3)`,
        id, tenantB.id, seq++,
      );
    }
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = ANY($1)`, allIds);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
  });

  it("flag on: runs the job once per active tenant, each scoped to its own rows", async () => {
    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    const { forEachTenant } = await import("./for-each-tenant");
    const { db } = await import("@/lib/db");
    const { currentTenantId } = await import("@/lib/tenant/context");

    const results = await forEachTenant(async () => ({
      tenantId: currentTenantId(),
      count: await db.auditEvent.count({ where: { id: { in: allIds } } }),
    }));

    // At least the two seeded tenants ran (others may exist, e.g. "default").
    expect(results.length).toBeGreaterThanOrEqual(2);
    const byTenant = new Map(results.map((r) => [r.tenantId, r.count]));
    expect(byTenant.get(tenantA.id)).toBe(idsA.length);
    expect(byTenant.get(tenantB.id)).toBe(idsB.length);
  });

  it("flag off: runs the job exactly once, unscoped (self-host behavior preserved)", async () => {
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    const { forEachTenant } = await import("./for-each-tenant");

    const job = vi.fn(async () => "ran");
    const results = await forEachTenant(job);

    expect(job).toHaveBeenCalledTimes(1);
    expect(results).toEqual(["ran"]);
  });
});
