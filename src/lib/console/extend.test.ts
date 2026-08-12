import { describe, it, expect } from "vitest";
import { nextEndsAt, EXTEND_OPTIONS } from "./extend";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("nextEndsAt", () => {
  it("extends from a future end", () => {
    expect(nextEndsAt("2026-08-12T18:00:00Z", 24, NOW)).toBe("2026-08-13T18:00:00.000Z");
  });
  it("extends from now when the end is already past", () => {
    expect(nextEndsAt("2026-08-12T06:00:00Z", 1, NOW)).toBe("2026-08-12T13:00:00.000Z");
  });
  it("extends from now when there is no end", () => {
    expect(nextEndsAt(null, 168, NOW)).toBe("2026-08-19T12:00:00.000Z");
  });
});

describe("EXTEND_OPTIONS", () => {
  it("offers +1h / +1d / +7d", () => {
    expect(EXTEND_OPTIONS).toEqual([
      { label: "+1h", hours: 1 },
      { label: "+1d", hours: 24 },
      { label: "+7d", hours: 168 },
    ]);
  });
});
