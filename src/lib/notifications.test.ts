import { describe, it, expect } from "vitest";
import { classifyTransition } from "./notifications";

describe("classifyTransition", () => {
  it("true -> false is down", () => expect(classifyTransition(true, false)).toBe("site_down"));
  it("null -> false is down (first check unreachable)", () => expect(classifyTransition(null, false)).toBe("site_down"));
  it("false -> true is recovered", () => expect(classifyTransition(false, true)).toBe("site_recovered"));
  it("no transition otherwise", () => {
    expect(classifyTransition(true, true)).toBeNull();
    expect(classifyTransition(false, false)).toBeNull();
    expect(classifyTransition(null, true)).toBeNull();
  });
});
