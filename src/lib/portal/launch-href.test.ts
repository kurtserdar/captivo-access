import { describe, it, expect } from "vitest";
import { launchHref } from "./launch-href";

describe("launchHref", () => {
  it("GATEWAY → native session page", () => {
    expect(launchHref("GATEWAY", "site123", "10.0.0.1:3389")).toBe("/gateway/site123/session");
  });
  it("web (TRANSPARENT) → https host", () => {
    expect(launchHref("TRANSPARENT", "site123", "app.internal")).toBe("https://app.internal");
  });
  it("ISOLATED → native session page like GATEWAY", () => {
    expect(launchHref("ISOLATED", "s1", "")).toBe("/gateway/s1/session");
  });
});
