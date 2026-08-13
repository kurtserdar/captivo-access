import { describe, it, expect } from "vitest";
import { duration, expiresIn, activeAgo } from "./format";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("duration", () => {
  it("minutes only", () => expect(duration("2026-08-12T11:55:00Z", NOW)).toBe("5m"));
  it("hours + zero-padded minutes", () => expect(duration("2026-08-12T10:55:00Z", NOW)).toBe("1h 05m"));
  it("just started", () => expect(duration("2026-08-12T12:00:00Z", NOW)).toBe("0m"));
});

describe("expiresIn", () => {
  it("more than an hour", () => expect(expiresIn("2026-08-13T02:16:00Z", NOW)).toBe("14h 16m"));
  it("under an hour", () => expect(expiresIn("2026-08-12T12:30:00Z", NOW)).toBe("under 1h"));
  it("already past → under 1h (clamped)", () => expect(expiresIn("2026-08-12T11:55:00Z", NOW)).toBe("under 1h"));
});

describe("activeAgo", () => {
  const N = new Date("2026-08-13T12:00:00Z");
  it("under 5s → just now", () => expect(activeAgo("2026-08-13T11:59:58Z", N)).toBe("just now"));
  it("seconds", () => expect(activeAgo("2026-08-13T11:59:15Z", N)).toBe("45s ago"));
  it("minutes (floored)", () => expect(activeAgo("2026-08-13T11:57:50Z", N)).toBe("2m ago"));
  it("future/negative clamps to just now", () => expect(activeAgo("2026-08-13T12:00:05Z", N)).toBe("just now"));
});
