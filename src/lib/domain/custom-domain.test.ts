import { describe, it, expect } from "vitest";
import { accessDomain, wildcardRecord, classifyVerify } from "./custom-domain";

describe("accessDomain", () => {
  it("strips a leading manager. from MANAGER_PUBLIC_URL", () => {
    expect(accessDomain("https://manager.access.example.com")).toBe("access.example.com");
  });
  it("honors an explicit ACCESS_DOMAIN over the URL", () => {
    expect(accessDomain("https://manager.access.example.com", "vendors.acme.com")).toBe("vendors.acme.com");
  });
  it("strips a leading *. from an explicit ACCESS_DOMAIN", () => {
    expect(accessDomain(undefined, "*.vendors.acme.com")).toBe("vendors.acme.com");
  });
  it("returns null for localhost / dev URLs", () => {
    expect(accessDomain("http://localhost:3100")).toBeNull();
  });
  it("returns null when there is no manager. prefix", () => {
    expect(accessDomain("https://access.example.com")).toBeNull();
  });
  it("returns null when unset or empty", () => {
    expect(accessDomain(undefined)).toBeNull();
    expect(accessDomain("")).toBeNull();
  });
  it("returns null for a bare single-label host after stripping", () => {
    expect(accessDomain("https://manager.localdomain")).toBeNull();
  });
});

describe("wildcardRecord", () => {
  it("prefixes *.", () => {
    expect(wildcardRecord("access.example.com")).toBe("*.access.example.com");
  });
});

describe("classifyVerify", () => {
  it("missing when nothing resolved", () => {
    expect(classifyVerify("203.0.113.5", [])).toBe("missing");
  });
  it("ok when the expected IP is present", () => {
    expect(classifyVerify("203.0.113.5", ["203.0.113.5"])).toBe("ok");
  });
  it("ok when the expected IP is among several", () => {
    expect(classifyVerify("203.0.113.5", ["198.51.100.1", "203.0.113.5"])).toBe("ok");
  });
  it("mismatch when it resolves elsewhere", () => {
    expect(classifyVerify("203.0.113.5", ["198.51.100.1"])).toBe("mismatch");
  });
});
