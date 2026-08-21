import { describe, it, expect } from "vitest";
import { buildRecordingWhere, parseRecordingFilter } from "./filter";

describe("buildRecordingWhere", () => {
  it("filters by userId and siteId", () => {
    const w = buildRecordingWhere({ userId: "u1", siteId: "s1", limit: 50, offset: 0 });
    expect(w.userId).toBe("u1");
    expect(w.siteId).toBe("s1");
  });
  it("builds a startedAt range from from/to", () => {
    const from = new Date("2026-08-01"); const to = new Date("2026-08-08");
    const w = buildRecordingWhere({ from, to, limit: 50, offset: 0 });
    expect(w.startedAt).toEqual({ gte: from, lte: to });
  });
  it("adds a case-insensitive host contains for q>=2", () => {
    const w = buildRecordingWhere({ q: "prox", limit: 50, offset: 0 });
    expect(w.host).toEqual({ contains: "prox", mode: "insensitive" });
  });
  it("ignores q shorter than 2 chars", () => {
    const w = buildRecordingWhere({ q: "p", limit: 50, offset: 0 });
    expect(w.host).toBeUndefined();
  });
});

describe("parseRecordingFilter", () => {
  const opts = { defaultLimit: 50, maxLimit: 200 };
  it("clamps limit to maxLimit and floors offset", () => {
    const f = parseRecordingFilter(new URLSearchParams("limit=9999&offset=10.7"), opts);
    expect(f.limit).toBe(200);
    expect(f.offset).toBe(10);
  });
  it("defaults limit and offset when absent", () => {
    const f = parseRecordingFilter(new URLSearchParams(""), opts);
    expect(f.limit).toBe(50);
    expect(f.offset).toBe(0);
  });
  it("parses valid dates and drops invalid ones", () => {
    const f = parseRecordingFilter(new URLSearchParams("from=2026-08-01&to=bad"), opts);
    expect(f.from).toBeInstanceOf(Date);
    expect(f.to).toBeUndefined();
  });
  it("parses and trims cmd", () => {
    const f = parseRecordingFilter(new URLSearchParams("cmd=%20%20rm%20-rf%20%20"), opts);
    expect(f.cmd).toBe("rm -rf");
  });
  it("cmd absent → undefined", () => {
    const f = parseRecordingFilter(new URLSearchParams(""), opts);
    expect(f.cmd).toBeUndefined();
  });
});
