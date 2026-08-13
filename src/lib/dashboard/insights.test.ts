import { describe, it, expect } from "vitest";
import {
  zeroFillDays, buildTrend, seriesFor, buildHeatmap,
  toRefCounts, buildTypeMix, toDenyReasons, toIpFlags, sessionStats,
} from "./insights";

describe("zeroFillDays", () => {
  it("returns `days` UTC keys oldest→newest ending today", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const keys = zeroFillDays(now, 30);
    expect(keys.length).toBe(30);
    expect(keys[29]).toBe("2026-08-11");
    expect(keys[28]).toBe("2026-08-10");
    expect(keys[0]).toBe("2026-07-13");
  });
});

describe("buildTrend", () => {
  it("maps allow/deny distinct-vendor day counts onto the zero-filled window", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    const allow = [{ day: "2026-08-11", count: 3 }, { day: "2026-08-10", count: 1 }, { day: "2000-01-01", count: 9 }];
    const deny = [{ day: "2026-08-11", count: 2 }];
    const t = buildTrend(allow, deny, now);
    expect(t.length).toBe(30);
    expect(t[29]).toEqual({ date: "2026-08-11", allow: 3, deny: 2 });
    expect(t[28]).toEqual({ date: "2026-08-10", allow: 1, deny: 0 });
    expect(t[27]).toEqual({ date: "2026-08-09", allow: 0, deny: 0 }); // no data → 0
    expect(t.some((d) => d.allow === 9)).toBe(false); // out-of-window key ignored
  });
});

describe("seriesFor", () => {
  it("aligns allow day-counts to the given day keys", () => {
    const days = ["2026-08-09", "2026-08-10", "2026-08-11"];
    const allow = [{ day: "2026-08-11", count: 3 }, { day: "2026-08-09", count: 5 }];
    expect(seriesFor(days, allow)).toEqual([5, 0, 3]);
  });
});

describe("buildHeatmap", () => {
  it("fills the right dow×hour cell and reports max, skipping out-of-range", () => {
    const { grid, max } = buildHeatmap([
      { dow: 2, hour: 9, count: 5 },
      { dow: 0, hour: 23, count: 8 },
      { dow: 9, hour: 0, count: 99 }, // out of range → skipped
    ]);
    expect(grid[2][9]).toBe(5);
    expect(grid[0][23]).toBe(8);
    expect(max).toBe(8);
  });
});

describe("toRefCounts", () => {
  it("maps rows and falls back label→id", () => {
    expect(toRefCounts([{ id: "s1", label: "App", count: 4 }, { id: "s2", label: null, count: 2 }]))
      .toEqual([{ id: "s1", label: "App", count: 4 }, { id: "s2", label: "s2", count: 2 }]);
  });
});

describe("buildTypeMix", () => {
  it("sums GATEWAY→remote and everything else→web", () => {
    expect(buildTypeMix([{ accessMode: "GATEWAY", count: 3 }, { accessMode: "TRANSPARENT", count: 5 }]))
      .toEqual({ web: 5, remote: 3 });
  });
});

describe("toDenyReasons", () => {
  it("totals all rows then returns the top `limit`", () => {
    const rows = [
      { reason: "not_a_member", count: 5 },
      { reason: "expired", count: 3 },
      { reason: "unspecified", count: 1 },
    ];
    const out = toDenyReasons(rows, 2);
    expect(out.total).toBe(9);
    expect(out.reasons).toEqual([{ label: "not_a_member", count: 5 }, { label: "expired", count: 3 }]);
  });
});

describe("toIpFlags", () => {
  it("passes through the SQL-filtered rows", () => {
    expect(toIpFlags([{ userEmail: "a@x.io", ipCount: 4 }])).toEqual([{ userEmail: "a@x.io", ipCount: 4 }]);
  });
});

describe("sessionStats", () => {
  it("returns zeros for no recordings", () => {
    expect(sessionStats([])).toEqual({ recordings: 0, totalHours: 0, avgMinutes: 0 });
  });
  it("computes count, total hours, average minutes", () => {
    const s = sessionStats([
      { startedAt: new Date("2026-08-11T10:00:00Z"), lastEventAt: new Date("2026-08-11T11:00:00Z") }, // 60m
      { startedAt: new Date("2026-08-11T10:00:00Z"), lastEventAt: new Date("2026-08-11T10:30:00Z") }, // 30m
    ]);
    expect(s.recordings).toBe(2);
    expect(s.totalHours).toBe(2); // 90m → round(1.5h)=2
    expect(s.avgMinutes).toBe(45);
  });
});
