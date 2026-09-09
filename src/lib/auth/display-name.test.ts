import { describe, it, expect } from "vitest";
import { normalizeDisplayName, isPlaceholderName } from "./display-name";

describe("normalizeDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeDisplayName("  Serdar   Kurt ")).toBe("Serdar Kurt");
  });
  it("rejects empty, non-string and over-long values", () => {
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName(undefined)).toBeNull();
    expect(normalizeDisplayName(42)).toBeNull();
    expect(normalizeDisplayName("x".repeat(101))).toBeNull();
    expect(normalizeDisplayName("x".repeat(100))).toHaveLength(100);
  });
});

describe("isPlaceholderName", () => {
  it("is true when the name is just the email", () => {
    expect(isPlaceholderName("a@b.co", "A@b.co")).toBe(true);
    expect(isPlaceholderName("Ada", "a@b.co")).toBe(false);
  });
});
