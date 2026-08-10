import { describe, it, expect } from "vitest";
import { grantEndsAtError, grantCapError } from "./grant-edit";

const now = new Date("2026-01-01T00:00:00.000Z");
const future = new Date("2026-02-01T00:00:00.000Z");
const past = new Date("2025-12-01T00:00:00.000Z");

describe("grantEndsAtError", () => {
  it("accepts a future end date with no start", () => {
    expect(grantEndsAtError(future, null, now)).toBeNull();
  });
  it("rejects an end date in the past", () => {
    expect(grantEndsAtError(past, null, now)).toBe("ends_at_in_past");
  });
  it("rejects an end date at/before the start", () => {
    const start = new Date("2026-02-15T00:00:00.000Z");
    expect(grantEndsAtError(future, start, now)).toBe("ends_at_before_start");
  });
  it("rejects an unparseable date", () => {
    expect(grantEndsAtError(new Date("nonsense"), null, now)).toBe("invalid_ends_at");
  });
});

describe("grantCapError", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86400_000);

  it("no cap (0/undefined) = always allowed", () => {
    expect(grantCapError(null, null, now, 0)).toBeNull();
    expect(grantCapError(null, days(3650), now, 0)).toBeNull();
  });
  it("under a cap, a permanent grant (no end) is rejected", () => {
    expect(grantCapError(null, null, now, 30)).toBe("grant_requires_end");
  });
  it("within the cap is allowed, over the cap is rejected", () => {
    expect(grantCapError(null, days(30), now, 30)).toBeNull();
    expect(grantCapError(null, days(31), now, 30)).toBe("grant_exceeds_max");
  });
  it("measures the window from startsAt when it's set", () => {
    expect(grantCapError(days(10), days(39), now, 30)).toBeNull(); // 29-day window
    expect(grantCapError(days(10), days(41), now, 30)).toBe("grant_exceeds_max"); // 31-day window
  });
});
