import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn() }, accessGrant: { findMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { evaluateAccess, classifyGrant } from "./evaluate";
import type { User, AccessGrant } from "@/generated/prisma/client";

type TestGrant = {
  status: "ACTIVE" | "REVOKED" | "DENIED";
  startsAt: Date | null;
  endsAt: Date | null;
  requiresApproval: boolean;
  approvedAt: Date | null;
  schedule: unknown;
};

const mockUser = (status: string | null) =>
  vi.mocked(db.user.findUnique).mockResolvedValue(
    status === null ? null : (({ status } as unknown) as User),
  );
const mockGrants = (g: TestGrant[]) =>
  vi.mocked(db.accessGrant.findMany).mockResolvedValue(g as unknown as AccessGrant[]);
const NOW = new Date("2026-07-27T12:00:00Z");
const grant = (o: Partial<TestGrant> = {}): TestGrant => ({
  status: "ACTIVE", startsAt: null, endsAt: null, requiresApproval: false, approvedAt: null, schedule: null, ...o,
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
  it("denies a DENIED grant with reason denied", async () => {
    mockUser("ACTIVE"); mockGrants([grant({ status: "DENIED" })]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "denied" });
  });
  it("prefers pending_approval over denied across grants", async () => {
    mockUser("ACTIVE");
    mockGrants([grant({ status: "DENIED" }), grant({ requiresApproval: true, approvedAt: null })]);
    expect(await evaluateAccess("u", "s", NOW)).toEqual({ allow: false, reason: "pending_approval" });
  });
  it("prefers pending_approval over off_schedule across grants", async () => {
    mockUser("ACTIVE");
    mockGrants([
      grant({ schedule: { timezone: "UTC", days: [0], start: "00:00", end: "01:00" } }), // off_schedule on a Monday
      grant({ requiresApproval: true, approvedAt: null }),
    ]);
    expect(await evaluateAccess("u", "s", new Date("2026-08-03T12:00:00Z"))).toEqual({ allow: false, reason: "pending_approval" });
  });
});

describe("classifyGrant", () => {
  it("allows a permanent active grant", () => {
    expect(classifyGrant(grant(), NOW)).toBe("allow");
  });
  it("reports revoked regardless of window", () => {
    expect(classifyGrant(grant({ status: "REVOKED" }), NOW)).toBe("revoked");
  });
  it("reports denied regardless of window", () => {
    expect(classifyGrant(grant({ status: "DENIED" }), NOW)).toBe("denied");
  });
  it("denies off_schedule when now is outside the recurring window", () => {
    // Sunday 2026-08-02 12:00Z, schedule is weekdays only → off_schedule
    const g = grant({ schedule: { timezone: "UTC", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } });
    expect(classifyGrant(g, new Date("2026-08-02T12:00:00Z"))).toBe("off_schedule");
  });
  it("allows when now is inside the recurring window", () => {
    // Monday 2026-08-03 12:00Z inside 09:00–18:00 UTC
    const g = grant({ schedule: { timezone: "UTC", days: [1], start: "09:00", end: "18:00" } });
    expect(classifyGrant(g, new Date("2026-08-03T12:00:00Z"))).toBe("allow");
  });
  it("fails closed on a malformed schedule (off_schedule, never allow)", () => {
    const g = grant({ schedule: { timezone: "UTC" } }); // missing days/start/end
    expect(classifyGrant(g, new Date("2026-08-03T12:00:00Z"))).toBe("off_schedule");
  });
});
