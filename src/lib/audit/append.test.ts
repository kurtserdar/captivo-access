import { describe, it, expect } from "vitest";
import { normalizeAuditInput } from "./append";

const noLookups = { emailById: new Map(), userNameById: new Map(), companyById: new Map(), siteNameById: new Map() };

describe("normalizeAuditInput", () => {
  it("defaults decision to ALLOW and passes DENY through", () => {
    expect(normalizeAuditInput({ decision: "DENY" }, noLookups).decision).toBe("DENY");
    expect(normalizeAuditInput({ decision: "whatever" }, noLookups).decision).toBe("ALLOW");
    expect(normalizeAuditInput({}, noLookups).decision).toBe("ALLOW");
  });
  it("clamps bytesOut to a non-negative bigint", () => {
    expect(normalizeAuditInput({ bytesOut: -5 }, noLookups).bytesOut).toBe(0n);
    expect(normalizeAuditInput({ bytesOut: 12.9 }, noLookups).bytesOut).toBe(12n);
  });
  it("leaves user/site fields null when no id is given", () => {
    const r = normalizeAuditInput({}, noLookups);
    expect(r.userId).toBeNull();
    expect(r.userEmail).toBeNull();
    expect(r.siteId).toBeNull();
    expect(r.siteName).toBeNull();
    expect(r.host).toBe("");
  });
  it("resolves display names from lookups when ids are present", () => {
    const lookups = {
      emailById: new Map([["u1", "v@x.io"]]),
      userNameById: new Map([["u1", "Vee"]]),
      companyById: new Map([["u1", "Acme"]]),
      siteNameById: new Map([["s1", "Deco"]]),
    };
    const r = normalizeAuditInput({ userId: "u1", siteId: "s1" }, lookups);
    expect(r.userEmail).toBe("v@x.io");
    expect(r.userName).toBe("Vee");
    expect(r.company).toBe("Acme");
    expect(r.siteName).toBe("Deco");
  });
});
