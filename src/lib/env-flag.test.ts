import { describe, it, expect } from "vitest";
import { flagOn } from "./env-flag";

describe("flagOn", () => {
  it("recognizes on-tokens → true (any default)", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE", " On "]) {
      expect(flagOn(v, false)).toBe(true);
      expect(flagOn(v, true)).toBe(true);
    }
  });
  it("recognizes off-tokens → false (any default)", () => {
    for (const v of ["0", "false", "off", "no", "OFF", " No "]) {
      expect(flagOn(v, true)).toBe(false);
      expect(flagOn(v, false)).toBe(false);
    }
  });
  it("unset/empty/unknown → the default", () => {
    for (const v of [undefined, "", "  ", "maybe", "2"]) {
      expect(flagOn(v, true)).toBe(true);
      expect(flagOn(v, false)).toBe(false);
    }
  });
});
