import { describe, it, expect } from "vitest";
import { remaining } from "./time-remaining";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("remaining", () => {
  it("permanent grant (no start/end): ok, no bar", () => {
    expect(remaining(null, null, null, NOW)).toEqual({ text: "Permanent", pct: 0, tone: "ok" });
  });
  it("schedule-bound (no fixed end): schedule tone", () => {
    const r = remaining(null, null, "business-hours", NOW);
    expect(r.tone).toBe("schedule");
    expect(r.pct).toBe(0);
  });
  it("ends in <24h: urgent", () => {
    const start = new Date("2026-08-12T00:00:00Z").toISOString(); // 12h ago
    const end = new Date("2026-08-13T00:00:00Z").toISOString();   // in 12h
    const r = remaining(start, end, null, NOW);
    expect(r.tone).toBe("urgent");
    expect(r.pct).toBe(50);            // half the 24h window elapsed
    expect(r.text).toContain("left");
  });
  it("ends in >24h: ok", () => {
    const start = new Date("2026-08-12T00:00:00Z").toISOString();
    const end = new Date("2026-08-15T00:00:00Z").toISOString();   // in 3d
    const r = remaining(start, end, null, NOW);
    expect(r.tone).toBe("ok");
    expect(r.pct).toBeGreaterThan(0);
    expect(r.pct).toBeLessThan(100);
  });
  it("past end: 100% elapsed, clamped", () => {
    const start = new Date("2026-08-10T00:00:00Z").toISOString();
    const end = new Date("2026-08-11T00:00:00Z").toISOString();
    expect(remaining(start, end, null, NOW).pct).toBe(100);
  });
});
