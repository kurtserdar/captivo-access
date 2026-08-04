import { describe, it, expect } from "vitest";
import { timeAgo } from "./format";

const NOW = 1_700_000_000_000;
describe("timeAgo", () => {
  it("seconds", () => expect(timeAgo(new Date(NOW - 5_000), NOW)).toBe("5s ago"));
  it("minutes", () => expect(timeAgo(new Date(NOW - 5 * 60_000), NOW)).toBe("5m ago"));
  it("hours", () => expect(timeAgo(new Date(NOW - 3 * 3_600_000), NOW)).toBe("3h ago"));
  it("days", () => expect(timeAgo(new Date(NOW - 2 * 86_400_000), NOW)).toBe("2d ago"));
  it("clamps future to 0s", () => expect(timeAgo(new Date(NOW + 10_000), NOW)).toBe("0s ago"));
});
