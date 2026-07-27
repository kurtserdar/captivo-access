import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn() }, accessGrant: { findMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { evaluateAccess, classifyGrant } from "./evaluate";

const mockUser = (status: string | null) =>
  (db.user.findUnique as any).mockResolvedValue(status === null ? null : { status });
const mockGrants = (g: any[]) => (db.accessGrant.findMany as any).mockResolvedValue(g);
const NOW = new Date("2026-07-27T12:00:00Z");
const grant = (o: Partial<any> = {}) => ({
  status: "ACTIVE", startsAt: null, endsAt: null, requiresApproval: false, approvedAt: null, ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("evaluateAccess", () => {
  it("denies a disabled/absent user before looking at grants", async () => {
    mockUser("DISABLED");
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "user_disabled" });
    mockUser(null);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "user_disabled" });
  });
  it("denies no_grant when the user has no grants for the site", async () => {
    mockUser("ACTIVE"); mockGrants([]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "no_grant" });
  });
  it("allows a permanent active grant (null window)", async () => {
    mockUser("ACTIVE"); mockGrants([grant()]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: true, reason: "allow" });
  });
  it("allows within a bounded window (inclusive boundaries)", async () => {
    mockUser("ACTIVE");
    mockGrants([grant({ startsAt: NOW, endsAt: NOW })]); // now == startsAt == endsAt
    expect((await evaluateAccess("u", "s", NOW)).allow).toBe(true);
  });
  it("denies not_yet before the window", async () => {
    mockUser("ACTIVE"); mockGrants([grant({ startsAt: new Date("2026-07-28T00:00:00Z") })]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "not_yet" });
  });
  it("denies expired after the window", async () => {
    mockUser("ACTIVE"); mockGrants([grant({ endsAt: new Date("2026-07-26T00:00:00Z") })]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "expired" });
  });
  it("denies revoked", async () => {
    mockUser("ACTIVE"); mockGrants([grant({ status: "REVOKED" })]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "revoked" });
  });
  it("denies pending_approval (dormant branch)", async () => {
    mockUser("ACTIVE"); mockGrants([grant({ requiresApproval: true, approvedAt: null })]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "pending_approval" });
  });
  it("allows if ANY grant allows (OR across multiple grants)", async () => {
    mockUser("ACTIVE"); mockGrants([grant({ status: "REVOKED" }), grant()]);
    expect((await evaluateAccess("u", "s", NOW)).allow).toBe(true);
  });
  it("picks the highest-priority deny reason across grants", async () => {
    mockUser("ACTIVE");
    // revoked (1) vs not_yet (3) → not_yet wins
    mockGrants([grant({ status: "REVOKED" }), grant({ startsAt: new Date("2026-07-28T00:00:00Z") })]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "not_yet" });
  });
});
