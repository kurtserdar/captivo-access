import { describe, it, expect } from "vitest";
import { remaining } from "./time-remaining";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("remaining", () => {
  it("permanent grant (no start/end): ok, full bar", () => {
    expect(remaining(null, null, null, NOW)).toEqual({ text: "Permanent", pct: 100, tone: "ok" });
  });
  it("schedule-bound (no fixed end): schedule tone, full bar", () => {
    const r = remaining(null, null, "business-hours", NOW);
    expect(r.tone).toBe("schedule");
    expect(r.pct).toBe(100);
  });
  it("ends in <24h: urgent, bar shows remaining", () => {
    const start = new Date("2026-08-12T00:00:00Z").toISOString(); // 12h ago
    const end = new Date("2026-08-13T00:00:00Z").toISOString();   // in 12h
    const r = remaining(start, end, null, NOW);
    expect(r.tone).toBe("urgent");
    expect(r.pct).toBe(50);            // half the 24h window remaining
    expect(r.text).toContain("left");
  });
  it("ends in >24h: ok, bar mostly full", () => {
    const start = new Date("2026-08-12T00:00:00Z").toISOString();
    const end = new Date("2026-08-15T00:00:00Z").toISOString();   // in 3d
    const r = remaining(start, end, null, NOW);
    expect(r.tone).toBe("ok");
    expect(r.pct).toBeGreaterThan(0);
    expect(r.pct).toBeLessThan(100);
  });
  it("fresh grant (barely started): bar near full", () => {
    const start = new Date("2026-08-12T11:59:00Z").toISOString(); // 1m ago
    const end = new Date("2026-08-14T12:00:00Z").toISOString();   // 2d window
    expect(remaining(start, end, null, NOW).pct).toBeGreaterThan(95);
  });
  it("past end: 0% remaining, clamped", () => {
    const start = new Date("2026-08-10T00:00:00Z").toISOString();
    const end = new Date("2026-08-11T00:00:00Z").toISOString();
    expect(remaining(start, end, null, NOW).pct).toBe(0);
  });
});
