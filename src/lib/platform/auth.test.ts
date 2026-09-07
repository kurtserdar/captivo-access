import { describe, it, expect } from "vitest";
import { isPlatformAdmin } from "./auth";

describe("isPlatformAdmin", () => {
  it("is true only for PLATFORM", () => {
    expect(isPlatformAdmin("PLATFORM")).toBe(true);
    for (const r of ["ADMIN", "OPERATOR", "AUDITOR", "STAFF", "VENDOR"] as const) {
      expect(isPlatformAdmin(r)).toBe(false);
    }
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});
