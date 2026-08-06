import { describe, it, expect } from "vitest";
import { buildAuditWhere, parseAuditFilter } from "./filter";

describe("buildAuditWhere", () => {
  it("adds no OR block when q is empty/whitespace", () => {
    expect(buildAuditWhere({ q: "   ", limit: 50, offset: 0 }).OR).toBeUndefined();
    expect(buildAuditWhere({ limit: 50, offset: 0 }).OR).toBeUndefined();
  });
  it("adds a case-insensitive OR across text columns for a non-empty q", () => {
    const where = buildAuditWhere({ q: " admin ", limit: 50, offset: 0 });
    expect(where.OR).toEqual([
      { path: { contains: "admin", mode: "insensitive" } },
      { host: { contains: "admin", mode: "insensitive" } },
      { userEmail: { contains: "admin", mode: "insensitive" } },
      { userName: { contains: "admin", mode: "insensitive" } },
      { company: { contains: "admin", mode: "insensitive" } },
    ]);
  });
  it("passes through the scalar filters", () => {
    const where = buildAuditWhere({ userId: "u1", siteId: "s1", decision: "DENY", limit: 50, offset: 0 });
    expect(where.userId).toBe("u1");
    expect(where.siteId).toBe("s1");
    expect(where.decision).toBe("DENY");
  });
});

describe("parseAuditFilter", () => {
  it("reads q and clamps limit to maxLimit", () => {
    const sp = new URLSearchParams({ q: " test ", limit: "9999" });
    const f = parseAuditFilter(sp, { defaultLimit: 50, maxLimit: 200 });
    expect(f.q).toBe("test");
    expect(f.limit).toBe(200);
  });
  it("defaults limit/offset and leaves q undefined when absent", () => {
    const f = parseAuditFilter(new URLSearchParams(), { defaultLimit: 50, maxLimit: 200 });
    expect(f.q).toBeUndefined();
    expect(f.limit).toBe(50);
    expect(f.offset).toBe(0);
  });
});
