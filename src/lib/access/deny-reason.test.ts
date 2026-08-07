import { describe, it, expect } from "vitest";
import { normalizeDenyReason } from "./deny-reason";

describe("normalizeDenyReason", () => {
  it("trims and returns a non-empty string", () => {
    expect(normalizeDenyReason("  not this quarter  ")).toBe("not this quarter");
  });
  it("returns null for empty/whitespace", () => {
    expect(normalizeDenyReason("")).toBeNull();
    expect(normalizeDenyReason("   ")).toBeNull();
  });
  it("returns null for non-strings", () => {
    expect(normalizeDenyReason(undefined)).toBeNull();
    expect(normalizeDenyReason(42)).toBeNull();
    expect(normalizeDenyReason({})).toBeNull();
  });
  it("caps at 500 characters", () => {
    expect(normalizeDenyReason("x".repeat(600))).toHaveLength(500);
  });
});
