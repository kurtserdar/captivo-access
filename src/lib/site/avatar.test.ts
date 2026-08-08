import { describe, it, expect } from "vitest";
import { siteAvatar } from "./avatar";

describe("siteAvatar", () => {
  it("is deterministic — same name yields identical output", () => {
    expect(siteAvatar("Grafana")).toEqual(siteAvatar("Grafana"));
  });
  it("takes first letters of the first two words, uppercased", () => {
    expect(siteAvatar("Home Grafana").initials).toBe("HG");
  });
  it("takes the first two letters of a single word", () => {
    expect(siteAvatar("Deco").initials).toBe("DE");
  });
  it("handles extra whitespace", () => {
    expect(siteAvatar("  Home   Grafana  ").initials).toBe("HG");
  });
  it("falls back to ? for an empty/blank name", () => {
    expect(siteAvatar("   ").initials).toBe("?");
    expect(siteAvatar("").initials).toBe("?");
  });
  it("returns a valid hsl bg and white fg", () => {
    const a = siteAvatar("Grafana");
    expect(a.bg).toMatch(/^hsl\(\d{1,3}, 55%, 45%\)$/);
    expect(a.fg).toBe("#fff");
  });
});
