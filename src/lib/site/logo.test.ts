import { describe, it, expect } from "vitest";
import { parseLogoUpload, MAX_LOGO_BYTES } from "./logo";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");

describe("parseLogoUpload", () => {
  it("keeps the existing logo when the field is absent", () => {
    expect(parseLogoUpload(undefined, undefined)).toEqual({ action: "keep" });
  });
  it("clears the logo on null or empty", () => {
    expect(parseLogoUpload(null, null)).toEqual({ action: "clear" });
    expect(parseLogoUpload("", "image/png")).toEqual({ action: "clear" });
  });
  it("sets a valid base64 png", () => {
    const r = parseLogoUpload(png1x1, "image/png");
    expect(r.action).toBe("set");
    if (r.action === "set") {
      expect(r.type).toBe("image/png");
      expect(r.data.length).toBeGreaterThan(0);
    }
  });
  it("accepts a data: URL and strips the prefix", () => {
    const r = parseLogoUpload("data:image/png;base64," + png1x1, "image/png");
    expect(r.action).toBe("set");
  });
  it("rejects a disallowed type", () => {
    expect(parseLogoUpload(png1x1, "image/gif")).toEqual({ action: "error", error: "invalid_logo_type" });
    expect(parseLogoUpload(png1x1, undefined)).toEqual({ action: "error", error: "invalid_logo_type" });
  });
  it("rejects an oversize logo", () => {
    const big = Buffer.alloc(MAX_LOGO_BYTES + 1, 0x41).toString("base64");
    expect(parseLogoUpload(big, "image/png")).toEqual({ action: "error", error: "logo_too_large" });
  });
  it("rejects a non-string logo", () => {
    expect(parseLogoUpload(123, "image/png")).toEqual({ action: "error", error: "invalid_logo" });
  });
});
