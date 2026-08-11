import { describe, it, expect } from "vitest";
import { buildTrend, buildHeatmap, topBy, denyReasons, ipFlags, activeVendors, typeMix, sessionStats, type AuditRow } from "./insights";

function row(p: Partial<AuditRow> & { timestamp: Date; decision: "ALLOW" | "DENY" }): AuditRow {
  return { siteName: null, siteId: null, userEmail: null, clientIp: null, reason: null, ...p };
}

describe("buildTrend", () => {
  it("zero-fills 30 UTC days oldest→newest and buckets allow/deny", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const rows = [
      row({ timestamp: new Date("2026-08-11T09:00:00Z"), decision: "ALLOW" }),
      row({ timestamp: new Date("2026-08-11T10:00:00Z"), decision: "DENY" }),
      row({ timestamp: new Date("2026-08-10T10:00:00Z"), decision: "ALLOW" }),
      row({ timestamp: new Date("2026-07-01T10:00:00Z"), decision: "ALLOW" }), // outside 30d
    ];
    const t = buildTrend(rows, now);
    expect(t.length).toBe(30);
    expect(t[29]).toEqual({ date: "2026-08-11", allow: 1, deny: 1 });
    expect(t[28]).toEqual({ date: "2026-08-10", allow: 1, deny: 0 });
    expect(t.reduce((s, d) => s + d.allow, 0)).toBe(2); // the 07-01 row is out of window
  });
});

describe("buildHeatmap", () => {
  it("increments the correct UTC day×hour cell and reports max", () => {
    const ts = new Date("2026-08-11T09:00:00Z");
    const { grid, max } = buildHeatmap([row({ timestamp: ts, decision: "ALLOW" }), row({ timestamp: ts, decision: "DENY" })]);
    expect(grid[ts.getUTCDay()][9]).toBe(2);
    expect(max).toBe(2);
  });
});

describe("topBy", () => {
  it("counts ALLOW by field, skips nulls, sorts desc, limits", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "ALLOW", siteName: "A" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteName: "A" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteName: "B" }),
      row({ timestamp: new Date(), decision: "DENY", siteName: "A" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteName: null }),
    ];
    expect(topBy(rows, "siteName", 5)).toEqual([{ label: "A", count: 2 }, { label: "B", count: 1 }]);
  });
});

describe("denyReasons", () => {
  it("groups DENY reasons, maps null→unspecified, totals + top N", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "DENY", reason: "no grant" }),
      row({ timestamp: new Date(), decision: "DENY", reason: "no grant" }),
      row({ timestamp: new Date(), decision: "DENY", reason: null }),
      row({ timestamp: new Date(), decision: "ALLOW", reason: "x" }),
    ];
    const d = denyReasons(rows, 5);
    expect(d.total).toBe(3);
    expect(d.reasons).toEqual([{ label: "no grant", count: 2 }, { label: "unspecified", count: 1 }]);
  });
});

describe("ipFlags", () => {
  it("flags vendors with >= threshold distinct IPs", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u", clientIp: "1.1.1.1" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u", clientIp: "2.2.2.2" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u", clientIp: "3.3.3.3" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "v", clientIp: "1.1.1.1" }),
    ];
    expect(ipFlags(rows, 3)).toEqual([{ userEmail: "u", ipCount: 3 }]);
  });
});

describe("topBy with decision", () => {
  it("groups DENY by field when decision is DENY", () => {
    const rows = [
      row({ timestamp: new Date(), decision: "DENY", userEmail: "u" }),
      row({ timestamp: new Date(), decision: "DENY", userEmail: "u" }),
      row({ timestamp: new Date(), decision: "ALLOW", userEmail: "u" }),
      row({ timestamp: new Date(), decision: "DENY", userEmail: "v" }),
    ];
    expect(topBy(rows, "userEmail", 5, "DENY")).toEqual([{ label: "u", count: 2 }, { label: "v", count: 1 }]);
  });
});

describe("activeVendors", () => {
  it("counts distinct ALLOW vendors and builds a 30-day daily-distinct series", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const rows = [
      row({ timestamp: new Date("2026-08-11T09:00:00Z"), decision: "ALLOW", userEmail: "a" }),
      row({ timestamp: new Date("2026-08-11T10:00:00Z"), decision: "ALLOW", userEmail: "b" }),
      row({ timestamp: new Date("2026-08-11T11:00:00Z"), decision: "ALLOW", userEmail: "a" }), // dup same day
      row({ timestamp: new Date("2026-08-10T10:00:00Z"), decision: "ALLOW", userEmail: "a" }),
      row({ timestamp: new Date("2026-08-11T10:00:00Z"), decision: "DENY", userEmail: "c" }),  // deny ignored
    ];
    const r = activeVendors(rows, now);
    expect(r.count).toBe(2);            // a, b
    expect(r.series.length).toBe(30);
    expect(r.series[29]).toBe(2);       // 08-11: a, b
    expect(r.series[28]).toBe(1);       // 08-10: a
  });
});

describe("typeMix", () => {
  it("buckets ALLOW events web/remote via the site-type map, skipping unmatched", () => {
    const map = new Map<string, "web" | "remote">([["s1", "web"], ["s2", "remote"]]);
    const rows = [
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s1" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s2" }),
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "s1" }),
      row({ timestamp: new Date(), decision: "DENY", siteId: "s1" }),  // deny ignored
      row({ timestamp: new Date(), decision: "ALLOW", siteId: "x" }),  // unmatched
      row({ timestamp: new Date(), decision: "ALLOW", siteId: null }), // null
    ];
    expect(typeMix(rows, map)).toEqual({ web: 2, remote: 1 });
  });
});

describe("sessionStats", () => {
  it("computes recordings, total hours, avg minutes; empty → zeros", () => {
    const base = new Date("2026-08-11T10:00:00Z").getTime();
    const recs = [
      { startedAt: new Date(base), lastEventAt: new Date(base + 30 * 60000) },      // 30m
      { startedAt: new Date(base), lastEventAt: new Date(base + 90 * 60000) },      // 90m
    ];
    expect(sessionStats(recs)).toEqual({ recordings: 2, totalHours: 2, avgMinutes: 60 });
    expect(sessionStats([])).toEqual({ recordings: 0, totalHours: 0, avgMinutes: 0 });
  });
});
