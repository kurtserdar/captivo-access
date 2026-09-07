import { describe, it, expect } from "vitest";
import { currentTenantId, withScope, currentTx } from "./context";

describe("tenant context", () => {
  it("defaults to the default tenant outside any scope", () => {
    expect(currentTenantId()).toBe("default");
  });
  it("returns the active tenant inside a scope", () => {
    withScope({ tenantId: "acme" }, () => expect(currentTenantId()).toBe("acme"));
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
    withScope({ tenantId: "a" }, () => {
      withScope({ tenantId: "b" }, () => expect(currentTenantId()).toBe("b"));
      expect(currentTenantId()).toBe("a");
    });
  });
});
