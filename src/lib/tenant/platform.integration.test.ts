import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const HAS_DB = !!process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

let owner: PrismaClient;
const ids: string[] = [];

beforeAll(async () => {
  owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) });
  // The platform tenant must be seeded by migration; ensure it for the test DB.
  await owner.$executeRawUnsafe(
    `INSERT INTO "Tenant"(id,slug,name) VALUES('platform','platform','Platform') ON CONFLICT (id) DO NOTHING`,
  );
});

afterAll(async () => {
  for (const id of ids) await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id=$1`, id).catch(() => {});
  await owner?.$disconnect();
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
