import { describe, it, expect } from "vitest";
import { duration, expiresIn } from "./format";

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
