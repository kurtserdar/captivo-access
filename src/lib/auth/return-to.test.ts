import { describe, it, expect, afterEach } from "vitest";
import { safeReturnTo } from "./return-to";

afterEach(() => {
  delete process.env.COOKIE_DOMAIN;
});

describe("safeReturnTo", () => {
  it("falls back to / when missing", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });

  it("allows a single-leading-slash relative path", () => {
    expect(safeReturnTo("/settings")).toBe("/settings");
  });

  it("rejects a protocol-relative path", () => {
    expect(safeReturnTo("//evil.com")).toBe("/");
  });

  it("rejects an absolute URL when COOKIE_DOMAIN is unset", () => {
    expect(safeReturnTo("https://evil.com/")).toBe("/");
  });

  describe("with COOKIE_DOMAIN set", () => {
    it("allows a subdomain of the cookie domain", () => {
      process.env.COOKIE_DOMAIN = ".access.example.com";
      expect(safeReturnTo("https://wiki.access.example.com/x")).toBe(
        "https://wiki.access.example.com/x"
      );
    });

    it("allows the bare cookie domain", () => {
      process.env.COOKIE_DOMAIN = ".access.example.com";
      expect(safeReturnTo("https://access.example.com/")).toBe("https://access.example.com/");
    });

    it("rejects an unrelated domain", () => {
      process.env.COOKIE_DOMAIN = ".access.example.com";
      expect(safeReturnTo("https://evil.com/")).toBe("/");
    });

    it("rejects non-https even for an allowed host", () => {
      process.env.COOKIE_DOMAIN = ".access.example.com";
      expect(safeReturnTo("http://wiki.access.example.com/")).toBe("/");
    });
  });
});
