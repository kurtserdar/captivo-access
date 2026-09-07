import { describe, it, expect } from "vitest";
import { PLATFORM_TENANT_ID, isReservedSlug, isValidTenantSlug } from "./constants";

describe("tenant constants", () => {
  it("pins the platform tenant id", () => {
    expect(PLATFORM_TENANT_ID).toBe("platform");
  });
  it("rejects reserved slugs (incl. platform + infra labels)", () => {
    for (const s of ["platform", "manager", "www", "app", "admin", "api"]) {
      expect(isReservedSlug(s)).toBe(true);
      expect(isValidTenantSlug(s)).toBe(false);
    }
  });
  it("accepts valid DNS-label slugs", () => {
    for (const s of ["acme", "acme-corp", "a1", "north-wind-2"]) {
      expect(isValidTenantSlug(s)).toBe(true);
    }
  });
  it("rejects malformed slugs", () => {
    for (const s of ["", "Acme", "acme_corp", "-acme", "acme-", "a".repeat(64), "a.b", "spar ta"]) {
      expect(isValidTenantSlug(s)).toBe(false);
    }
  });
});
