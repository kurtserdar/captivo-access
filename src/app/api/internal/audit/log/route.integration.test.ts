// Proves internal/audit/log groups a single shared-data-plane batch by
// per-event tenant (resolved from siteId) and appends each group under its own
// tenant scope, rather than being wrapped in withTenantFrom (single tenant per
// request) like the other internal/* endpoints — see the route's doc comment.
// Calls the real exported POST handler with MULTI_TENANT on, posts one batch
// mixing events from two tenants' sites plus one event for an unresolvable
// site, and asserts (verified as owner):
//   - tenant A's AuditEvent rows contain only tenant A's events,
//   - tenant B's AuditEvent rows contain only tenant B's events,
//   - the unresolvable event is dropped (not inserted anywhere) and counted,
//   - an unauthenticated POST is 401 and appends nothing at all.
// Requires a live Postgres via TEST_DATABASE_URL (owner connection, schema
// pushed, bootstrap.sql applied, `app` role present); SKIPPED otherwise. MUST
// run in its own vitest process (mutates process-wide env + the db module
// cache) — mirrors internal-endpoints.integration.test.ts's env setup.
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
const tenantA = { id: `aud-a-${suffix}`, slug: `aud-a-${suffix}` };
const tenantB = { id: `aud-b-${suffix}`, slug: `aud-b-${suffix}` };
const connectorA = `audc-a-${suffix}`;
const connectorB = `audc-b-${suffix}`;
const siteA = `auds-a-${suffix}`;
const siteB = `auds-b-${suffix}`;
const DP_SECRET = `aud-dp-secret-${suffix}`;

function logReq(events: Record<string, unknown>[], headers: Record<string, string> = {}): NextRequest {
  return new Request("http://internal/api/internal/audit/log", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": DP_SECRET, ...headers },
    body: JSON.stringify({ events }),
  }) as unknown as NextRequest;
}

describe.skipIf(!OWNER_URL)("internal/audit/log groups a batch by per-event tenant (app role)", () => {
  let owner: PrismaClient;
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'Audit Test A','ACTIVE'),($3,$4,'Audit Test B','ACTIVE')`,
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
    process.env.DATAPLANE_SECRET = DP_SECRET;
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();
    ({ POST } = await import("@/app/api/internal/audit/log/route"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "siteId" IN ($1,$2)`, siteA, siteB);
    await owner.$executeRawUnsafe(`DELETE FROM "AuditChainState" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "Site" WHERE id IN ($1,$2)`, siteA, siteB);
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE id IN ($1,$2)`, connectorA, connectorB);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.DATAPLANE_SECRET;
  });

  it("splits an interleaved batch so each tenant's chain receives only its own events, and drops unresolvable ones", async () => {
    const res = await POST(
      logReq([
        { siteId: siteA, host: "a.example.test", path: "/a/1", method: "GET", status: 200, decision: "ALLOW" },
        { siteId: siteB, host: "b.example.test", path: "/b/1", method: "GET", status: 200, decision: "ALLOW" },
        { siteId: siteA, host: "a.example.test", path: "/a/2", method: "GET", status: 200, decision: "ALLOW" },
        { siteId: "nope-site", host: "nope.example.test", path: "/x", method: "GET", status: 200, decision: "ALLOW" },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 3, dropped: 1 });

    const rowsA = await owner.$queryRawUnsafe<{ path: string }[]>(
      `SELECT path FROM "AuditEvent" WHERE "tenantId" = $1 ORDER BY path`,
      tenantA.id,
    );
    expect(rowsA.map((r) => r.path)).toEqual(["/a/1", "/a/2"]);

    const rowsB = await owner.$queryRawUnsafe<{ path: string }[]>(
      `SELECT path FROM "AuditEvent" WHERE "tenantId" = $1 ORDER BY path`,
      tenantB.id,
    );
    expect(rowsB.map((r) => r.path)).toEqual(["/b/1"]);

    const total = await owner.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "AuditEvent" WHERE path = '/x'`,
    );
    expect(total[0].count).toBe(BigInt(0));
  });

  it("an unauthenticated POST is 401 and never resolves or appends anything", async () => {
    const res = await POST(logReq([{ siteId: siteA, path: "/should-not-land" }], { "x-dataplane-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });

    const rows = await owner.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "AuditEvent" WHERE path = '/should-not-land'`,
    );
    expect(rows[0].count).toBe(BigInt(0));
  });
});
