import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Serdar@X.com ")).toBe("serdar@x.com");
  });
  it("leaves an already-normalized email unchanged", () => {
    expect(normalizeEmail("ops@vendor.co")).toBe("ops@vendor.co");
  });
  it("returns empty string for empty input", () => {
    expect(normalizeEmail("")).toBe("");
  });
});
