import { describe, it, expect } from "vitest";
import { grantEndsAtError } from "./grant-edit";

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
