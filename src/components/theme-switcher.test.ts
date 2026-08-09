import { describe, it, expect } from "vitest";
import { resolveTheme } from "./theme-switcher";

describe("resolveTheme", () => {
  it("returns the explicit preference as-is", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("follows the OS for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("returns resend as an explicit preference", () => {
    expect(resolveTheme("resend", true)).toBe("resend");
    expect(resolveTheme("resend", false)).toBe("resend");
  });
});
