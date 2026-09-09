import { describe, it, expect } from "vitest";
import { parseLimits, parseCapabilities, limitsForStorage, withinLimit, trialState, formatBytes, isPlan } from "./tenant-shape";

describe("parseLimits", () => {
  it("keeps positive integers, coerces numeric strings, drops junk", () => {
    expect(parseLimits({ maxUsers: 10, maxSites: "5", maxConnectors: 0, maxRecordingRetentionDays: -1, bogus: 3 })).toEqual({ maxUsers: 10, maxSites: 5 });
    expect(parseLimits(null)).toEqual({});
    expect(parseLimits("x")).toEqual({});
    expect(parseLimits({ maxUsers: "" })).toEqual({});
  });
  it("stores null when empty", () => {
    expect(limitsForStorage({})).toBeNull();
    expect(limitsForStorage({ maxUsers: 1 })).toEqual({ maxUsers: 1 });
  });
});

describe("parseCapabilities", () => {
  it("keeps only booleans for known keys", () => {
    expect(parseCapabilities({ recording: false, vault: true, isolated: "yes", nope: true })).toEqual({ recording: false, vault: true });
  });
});

describe("withinLimit / trialState / formatBytes / isPlan", () => {
  it("withinLimit", () => {
    expect(withinLimit({}, "maxUsers", 999)).toBe(true);
    expect(withinLimit({ maxUsers: 3 }, "maxUsers", 2)).toBe(true);
    expect(withinLimit({ maxUsers: 3 }, "maxUsers", 3)).toBe(false);
  });
  it("trialState", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    expect(trialState("standard", null, now)).toBe("none");
    expect(trialState("trial", null, now)).toBe("active");
    expect(trialState("trial", new Date("2026-09-09T00:00:00Z"), now)).toBe("expired");
    expect(trialState("trial", new Date("2026-09-13T00:00:00Z"), now)).toBe("ending_soon");
    expect(trialState("trial", new Date("2026-10-13T00:00:00Z"), now)).toBe("active");
  });
  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });
  it("isPlan", () => {
    expect(isPlan("trial")).toBe(true);
    expect(isPlan("gold")).toBe(false);
  });
});
