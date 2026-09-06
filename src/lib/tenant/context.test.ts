import { describe, it, expect } from "vitest";
import { withTenant, currentTenantId, injectTenant } from "./context";

describe("tenant context", () => {
  it("defaults to the default tenant outside any scope", () => {
    expect(currentTenantId()).toBe("default");
  });
  it("returns the active tenant inside withTenant", () => {
    withTenant("acme", () => expect(currentTenantId()).toBe("acme"));
  });
  it("restores the outer tenant after a nested scope", () => {
    withTenant("a", () => {
      withTenant("b", () => expect(currentTenantId()).toBe("b"));
      expect(currentTenantId()).toBe("a");
    });
  });
  it("injectTenant adds tenantId into data when absent", () => {
    withTenant("acme", () => {
      expect(injectTenant({ data: { name: "x" } })).toEqual({ data: { name: "x", tenantId: "acme" } });
    });
  });
  it("injectTenant leaves an explicit tenantId untouched", () => {
    withTenant("acme", () => {
      expect(injectTenant({ data: { name: "x", tenantId: "other" } })).toEqual({ data: { name: "x", tenantId: "other" } });
    });
  });
});
