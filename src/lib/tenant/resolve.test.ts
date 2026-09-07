import { describe, it, expect } from "vitest";
import { slugFromHost } from "./resolve";

const AD = "access.example.com";

describe("slugFromHost", () => {
  it("extracts a single-label tenant slug", () => {
    expect(slugFromHost("acme.access.example.com", AD)).toBe("acme");
    expect(slugFromHost("ACME.Access.Example.com", AD)).toBe("acme");
    expect(slugFromHost("acme.access.example.com:3100", AD)).toBe("acme");
  });
  it("returns null for the bare access domain / reserved labels", () => {
    expect(slugFromHost("access.example.com", AD)).toBeNull();
    expect(slugFromHost("manager.access.example.com", AD)).toBeNull();
    expect(slugFromHost("www.access.example.com", AD)).toBeNull();
    expect(slugFromHost("api.access.example.com", AD)).toBeNull();
  });
  it("returns null for multi-label or non-matching hosts", () => {
    expect(slugFromHost("a.b.access.example.com", AD)).toBeNull();
    expect(slugFromHost("acme.other.com", AD)).toBeNull();
    expect(slugFromHost("", AD)).toBeNull();
    expect(slugFromHost("acme.access.example.com", null)).toBeNull();
  });
});
