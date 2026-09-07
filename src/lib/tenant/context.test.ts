import { describe, it, expect } from "vitest";
import { withTenant, currentTenantId, fillTenant, whereTenant, withScope, currentTx } from "./context";

describe("tenant context", () => {
  it("defaults to the default tenant outside any scope", () => {
    expect(currentTenantId()).toBe("default");
  });
  it("returns the active tenant inside withTenant", () => {
    withTenant("acme", () => expect(currentTenantId()).toBe("acme"));
  });
  it("currentTx is null outside a scope", () => {
    expect(currentTx()).toBeNull();
  });
  it("withScope exposes both tenantId and tx", () => {
    const fakeTx = { marker: 1 };
    withScope({ tenantId: "acme", tx: fakeTx }, () => {
      expect(currentTenantId()).toBe("acme");
      expect(currentTx()).toBe(fakeTx);
    });
    expect(currentTx()).toBeNull();
  });
  it("restores the outer tenant after a nested scope", () => {
    withTenant("a", () => {
      withTenant("b", () => expect(currentTenantId()).toBe("b"));
      expect(currentTenantId()).toBe("a");
    });
  });
  it("fillTenant adds tenantId to a row when absent", () => {
    withTenant("acme", () => {
      expect(fillTenant({ name: "x" })).toEqual({ name: "x", tenantId: "acme" });
    });
  });
  it("fillTenant leaves an explicit tenantId untouched", () => {
    withTenant("acme", () => {
      expect(fillTenant({ name: "x", tenantId: "other" })).toEqual({ name: "x", tenantId: "other" });
    });
  });
  it("fillTenant passes non-objects through", () => {
    withTenant("acme", () => {
      expect(fillTenant(undefined)).toBe(undefined);
    });
  });
  it("whereTenant adds tenantId to an empty/absent where", () => {
    withTenant("acme", () => {
      expect(whereTenant({})).toEqual({ where: { tenantId: "acme" } });
      expect(whereTenant({ where: { name: "x" } })).toEqual({ where: { name: "x", tenantId: "acme" } });
    });
  });
  it("whereTenant leaves an explicit tenantId untouched", () => {
    withTenant("acme", () => {
      expect(whereTenant({ where: { tenantId: "other" } })).toEqual({ where: { tenantId: "other" } });
    });
  });
});
