import { describe, it, expect } from "vitest";
import { buildTrend, buildHeatmap, topBy, denyReasons, ipFlags, type AuditRow } from "./insights";

function row(p: Partial<AuditRow> & { timestamp: Date; decision: "ALLOW" | "DENY" }): AuditRow {
  return { siteName: null, userEmail: null, clientIp: null, reason: null, ...p };
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
