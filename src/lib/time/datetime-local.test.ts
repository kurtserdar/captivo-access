import { describe, it, expect } from "vitest";
import { parseDatetimeLocal, formatDatetimeLocal, startOfDayInZone, endOfDayInZone, isValidTimeZone } from "./datetime-local";

describe("parseDatetimeLocal", () => {
  it("interprets the wall time in the given zone (fixed offset)", () => {
    expect(parseDatetimeLocal("2026-09-10T09:00", "Europe/Istanbul")?.toISOString()).toBe("2026-09-10T06:00:00.000Z");
    expect(parseDatetimeLocal("2026-09-10T09:00", "UTC")?.toISOString()).toBe("2026-09-10T09:00:00.000Z");
    expect(parseDatetimeLocal("2026-09-10T09:00", "Asia/Kolkata")?.toISOString()).toBe("2026-09-10T03:30:00.000Z");
  });

  it("is DST-aware (New York summer vs winter)", () => {
    expect(parseDatetimeLocal("2026-07-01T09:00", "America/New_York")?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(parseDatetimeLocal("2026-01-15T09:00", "America/New_York")?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("handles a DST transition day correctly on both sides of the switch", () => {
    // US spring-forward 2026-03-08 02:00 → 03:00 EST→EDT.
    expect(parseDatetimeLocal("2026-03-08T01:30", "America/New_York")?.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(parseDatetimeLocal("2026-03-08T03:30", "America/New_York")?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("accepts seconds and rejects malformed or impossible values", () => {
    expect(parseDatetimeLocal("2026-09-10T09:00:30", "UTC")?.toISOString()).toBe("2026-09-10T09:00:30.000Z");
    expect(parseDatetimeLocal("", "UTC")).toBeNull();
    expect(parseDatetimeLocal("2026-09-10", "UTC")).toBeNull();
    expect(parseDatetimeLocal("2026-02-30T09:00", "UTC")).toBeNull();
    expect(parseDatetimeLocal("2026-13-01T09:00", "UTC")).toBeNull();
    expect(parseDatetimeLocal("2026-09-10T24:00", "UTC")).toBeNull();
  });

  it("falls back to the runtime's local zone when tz is null", () => {
    const d = parseDatetimeLocal("2026-09-10T09:00", null)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });
});

describe("formatDatetimeLocal", () => {
  it("round-trips with parseDatetimeLocal in a zone", () => {
    for (const tz of ["Europe/Istanbul", "America/Los_Angeles", "Australia/Sydney", "UTC"]) {
      const v = "2026-11-03T18:45";
      expect(formatDatetimeLocal(parseDatetimeLocal(v, tz)!, tz)).toBe(v);
    }
  });
  it("formats an instant as seen in the zone", () => {
    expect(formatDatetimeLocal(new Date("2026-09-10T06:00:00Z"), "Europe/Istanbul")).toBe("2026-09-10T09:00");
    expect(formatDatetimeLocal(new Date("2026-09-10T23:30:00Z"), "Asia/Tokyo")).toBe("2026-09-11T08:30");
  });
  it("returns empty for an invalid date", () => {
    expect(formatDatetimeLocal(new Date("nope"), "UTC")).toBe("");
  });
  it("uses the local zone when tz is null", () => {
    const d = new Date(2026, 8, 10, 9, 5);
    expect(formatDatetimeLocal(d, null)).toBe("2026-09-10T09:05");
  });
});

describe("day bounds", () => {
  it("startOfDayInZone / endOfDayInZone bracket the local calendar day", () => {
    expect(startOfDayInZone("2026-09-10", "Europe/Istanbul")?.toISOString()).toBe("2026-09-09T21:00:00.000Z");
    expect(endOfDayInZone("2026-09-10", "Europe/Istanbul")?.toISOString()).toBe("2026-09-10T20:59:59.999Z");
  });
  it("is DST-safe across a 23h day", () => {
    // 2026-03-08 in New York is 23 hours long.
    const s = startOfDayInZone("2026-03-08", "America/New_York")!;
    const e = endOfDayInZone("2026-03-08", "America/New_York")!;
    expect(e.getTime() - s.getTime() + 1).toBe(23 * 3600 * 1000);
  });
  it("rejects malformed input", () => {
    expect(startOfDayInZone("2026-9-1", "UTC")).toBeNull();
    expect(endOfDayInZone("2026-02-30", "UTC")).toBeNull();
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone("Europe/Istanbul")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
