// Proves connector auth/enrollment adopt the RIGHT tenant when scanning
// bcrypt/argon2 candidates cross-tenant (Task 6): tokenHash/codeHash can't be
// looked up by column equality, so `db.connector.findMany()`/
// `db.connectorPairing.findMany()` with no ambient tenant scope return
// NOTHING under RLS (fail-closed) — the real production code must scan via
// the Task-2 SECURITY DEFINER candidate-list functions, argon2-verify each
// row, then adopt the MATCHED row's tenantId and do the rest of the work
// (status/lastSeen read for auth; pairing consumption + connector
// create/rotate for enroll) under that tenant's own RLS scope.
//
// Drives the real exported route handlers (POST) as the non-owner `app` role
// with MULTI_TENANT on, seeding two tenants each with their own connector
// token / pairing code, mirroring internal-endpoints.integration.test.ts's
// env setup. Requires a live Postgres via TEST_DATABASE_URL (owner
// connection, schema pushed, bootstrap.sql applied, `app` role present);
// SKIPPED otherwise. MUST run in its own vitest process (mutates process-wide
// env + the db module cache).
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
const tenantA = { id: `cet-a-${suffix}`, slug: `cet-a-${suffix}` };
const tenantB = { id: `cet-b-${suffix}`, slug: `cet-b-${suffix}` };
const connectorB = `cetc-b-${suffix}`;
const pairingA = `cetp-a-${suffix}`;
const DP_SECRET = `cet-dp-secret-${suffix}`;

// Known raw values whose argon2 hashes are seeded directly (owner connection,
// bypassing createPairing/generateToken) so the test controls exactly what
// the routes must verify against.
const CONNECTOR_TOKEN = `cet-token-${suffix}`;
const PAIR_CODE = `cet-paircode-${suffix}`;

function authReq(body: Record<string, unknown>): NextRequest {
  return new Request("http://internal/api/internal/connector/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dataplane-secret": DP_SECRET },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function enrollReq(body: Record<string, unknown>): NextRequest {
  return new Request("http://internal/api/connector/enroll", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe.skipIf(!OWNER_URL)("connector auth/enrollment adopt the matched candidate's tenant (app role)", () => {
  let owner: PrismaClient;
  let authPOST: (req: NextRequest) => Promise<Response>;
  let enrollPOST: (req: NextRequest) => Promise<Response>;
  let hashToken: (t: string) => Promise<string>;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

    await owner.$executeRawUnsafe(
      `INSERT INTO "Tenant"(id,slug,name,status) VALUES($1,$2,'CET Test A','ACTIVE'),($3,$4,'CET Test B','ACTIVE')`,
      tenantA.id, tenantA.slug, tenantB.id, tenantB.slug,
    );

    process.env.MULTI_TENANT = "on";
    process.env.APP_DATABASE_URL = toAppUrl(OWNER_URL!);
    process.env.DATAPLANE_SECRET = DP_SECRET;
    delete (globalThis as { prismaBase?: unknown }).prismaBase;
    vi.resetModules();

    ({ hashToken } = await import("@/lib/auth/tokens"));

    // Seed a Connector in tenant B with a known token's hash, and a
    // ConnectorPairing in tenant A with a known code's hash — as owner
    // (RLS-bypass), same as the other candidate-scan fixtures.
    await owner.$executeRawUnsafe(
      `INSERT INTO "Connector"(id,"tenantId",name,"tokenHash",status,"createdAt") VALUES($1,$2,'Connector B','${await hashToken(CONNECTOR_TOKEN)}','PENDING',now())`,
      connectorB, tenantB.id,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "ConnectorPairing"(id,"tenantId","codeHash",name,"expiresAt","createdAt") VALUES($1,$2,'${await hashToken(PAIR_CODE)}','Pairing A', now() + interval '1 hour', now())`,
      pairingA, tenantA.id,
    );

    ({ POST: authPOST } = await import("@/app/api/internal/connector/auth/route"));
    ({ POST: enrollPOST } = await import("@/app/api/connector/enroll/route"));
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM "Connector" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "ConnectorPairing" WHERE "tenantId" IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id IN ($1,$2)`, tenantA.id, tenantB.id);
    await owner.$disconnect();
    delete process.env.MULTI_TENANT;
    delete process.env.APP_DATABASE_URL;
    delete process.env.DATAPLANE_SECRET;
  });

  it("connector/auth: tenant B's token authenticates, adopting tenant B — never visible to tenant A's scope", async () => {
    const res = await authPOST(authReq({ token: CONNECTOR_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connectorId).toBe(connectorB);
    expect(body.tenantId).toBe(tenantB.id);

    // Verify as owner (RLS-bypass) that the connector really lives in tenant B.
    const rows = await owner.$queryRawUnsafe<{ tenantId: string }[]>(
      `SELECT "tenantId" FROM "Connector" WHERE id = $1`, connectorB,
    );
    expect(rows[0]?.tenantId).toBe(tenantB.id);
  });

  it("connector/auth: an unknown token is rejected, not falsely attributed to either tenant", async () => {
    const res = await authPOST(authReq({ token: "not-a-real-token" }));
    expect(res.status).toBe(401);
  });

  it("connector/enroll: tenant A's pairing code creates a connector IN tenant A", async () => {
    const res = await enrollPOST(enrollReq({ pairCode: PAIR_CODE, name: "New Connector" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.connectorId).toBe("string");
    expect(typeof body.token).toBe("string");

    // Verify as owner (RLS-bypass): the new connector row landed in tenant A,
    // and the pairing is now consumed.
    const conn = await owner.$queryRawUnsafe<{ tenantId: string }[]>(
      `SELECT "tenantId" FROM "Connector" WHERE id = $1`, body.connectorId,
    );
    expect(conn[0]?.tenantId).toBe(tenantA.id);

    const pairing = await owner.$queryRawUnsafe<{ usedAt: Date | null }[]>(
      `SELECT "usedAt" FROM "ConnectorPairing" WHERE id = $1`, pairingA,
    );
    expect(pairing[0]?.usedAt).not.toBeNull();

    // The pairing is single-use: redeeming the same code again must fail.
    const second = await enrollPOST(enrollReq({ pairCode: PAIR_CODE, name: "New Connector" }));
    expect(second.status).toBe(401);
  });
});
