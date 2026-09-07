import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const HAS_DB = !!process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const APP_PW = "rls_test_pw";
function appUrlFrom(owner: string): string {
  const u = new URL(owner);
  u.username = "app";
  u.password = APP_PW;
  return u.toString();
}

let owner: PrismaClient;
const ids: string[] = [];
const createdIds: string[] = [];

beforeAll(async () => {
  owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) });
  // The platform tenant must be seeded by migration; ensure it for the test DB.
  await owner.$executeRawUnsafe(
    `INSERT INTO "Tenant"(id,slug,name) VALUES('platform','platform','Platform') ON CONFLICT (id) DO NOTHING`,
  );
});

afterAll(async () => {
  for (const id of ids) await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id=$1`, id).catch(() => {});
  for (const id of createdIds) await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id=$1`, id).catch(() => {});
  await owner?.$disconnect();
  delete process.env.MULTI_TENANT;
  delete process.env.APP_DATABASE_URL;
});

d("platform SECURITY DEFINER functions", () => {
  it("creates, lists, and sets status", async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    const slug = `t-${id.slice(0, 8)}`;
    const created = await owner.$queryRawUnsafe<{ id: string }[]>(
      `SELECT platform_create_tenant($1,$2,$3) AS id`, id, slug, "Acme",
    );
    expect(created[0].id).toBe(id);

    const list = await owner.$queryRawUnsafe<{ id: string; adminCount: bigint }[]>(`SELECT * FROM platform_list_tenants()`);
    const row = list.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(list.find((r) => (r as unknown as { slug: string }).slug === "platform")).toBeFalsy();

    await owner.$executeRawUnsafe(`SELECT platform_set_tenant_status($1,'SUSPENDED')`, id);
    const after = await owner.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM "Tenant" WHERE id=$1`, id);
    expect(after[0].status).toBe("SUSPENDED");
  });

  it("rejects an invalid status and refuses the platform tenant", async () => {
    await expect(owner.$executeRawUnsafe(`SELECT platform_set_tenant_status('platform','SUSPENDED')`)).rejects.toThrow();
    const id = ids[0];
    await expect(owner.$executeRawUnsafe(`SELECT platform_set_tenant_status($1,'NOPE')`, id)).rejects.toThrow();
  });
});

d("createTenant provisions a tenant + invite (app role, flag on)", () => {
  it("creates the tenant, seeds an invite in it, lists it, and suspend hides it", async () => {
    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = appUrlFrom(process.env.TEST_DATABASE_URL!);
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).prismaBase;

    const { createTenant, listTenants, setTenantStatus } = await import("@/lib/platform/tenants");
    const { resolveTenantBySlug } = await import("@/lib/tenant/resolve");

    const slug = `it-${crypto.randomUUID().slice(0, 8)}`;
    const { tenant, inviteToken } = await createTenant({ name: "IT Co", slug, adminEmail: "admin@it.co" });
    createdIds.push(tenant.id);
    expect(inviteToken).toBeTruthy();

    // The invite exists IN THE NEW TENANT (verified as owner, RLS-bypassed).
    const invites = await owner.$queryRawUnsafe<{ email: string; tenantId: string }[]>(
      `SELECT email, "tenantId" FROM "Invite" WHERE "tenantId"=$1`, tenant.id,
    );
    expect(invites).toHaveLength(1);
    expect(invites[0].email).toBe("admin@it.co");

    const list = await listTenants();
    expect(list.find((t) => t.id === tenant.id)).toBeTruthy();

    expect(await resolveTenantBySlug(slug)).toBe(tenant.id);
    await setTenantStatus(tenant.id, "SUSPENDED");
    expect(await resolveTenantBySlug(slug)).toBeNull(); // ACTIVE filter → suspended slug stops resolving
  });

  it("rejects a duplicate slug with PlatformError(slug_taken), not a masked DB error", async () => {
    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = appUrlFrom(process.env.TEST_DATABASE_URL!);
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).prismaBase;

    const { createTenant, PlatformError } = await import("@/lib/platform/tenants");

    const slug = `dup-${crypto.randomUUID().slice(0, 8)}`;
    const first = await createTenant({ name: "First Co", slug, adminEmail: "admin@first.co" });
    createdIds.push(first.tenant.id);

    let caught: unknown;
    try {
      await createTenant({ name: "Second Co", slug, adminEmail: "admin@second.co" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as InstanceType<typeof PlatformError>).code).toBe("slug_taken");
  });
});
