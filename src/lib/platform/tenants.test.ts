import { describe, it, expect } from "vitest";
import { validateCreateInput, PlatformError } from "./tenants";

describe("validateCreateInput", () => {
  it("accepts a clean input", () => {
    expect(() => validateCreateInput({ name: "Acme", slug: "acme", adminEmail: "a@acme.co" })).not.toThrow();
  });
  it("rejects a reserved/invalid slug", () => {
    expect(() => validateCreateInput({ name: "X", slug: "platform", adminEmail: "a@b.co" })).toThrow(PlatformError);
    expect(() => validateCreateInput({ name: "X", slug: "Bad_Slug", adminEmail: "a@b.co" })).toThrow(/invalid_slug/);
  });
  it("rejects an empty name", () => {
    expect(() => validateCreateInput({ name: "  ", slug: "acme", adminEmail: "a@b.co" })).toThrow(/invalid_name/);
  });
  it("rejects a malformed email", () => {
    expect(() => validateCreateInput({ name: "Acme", slug: "acme", adminEmail: "nope" })).toThrow(/invalid_email/);
  });
});
