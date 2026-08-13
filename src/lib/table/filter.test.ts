import { describe, it, expect } from "vitest";
import { textMatch } from "./filter";

describe("textMatch", () => {
  it("empty/whitespace query matches everything", () => {
    expect(textMatch(["anything"], "")).toBe(true);
    expect(textMatch(["anything"], "   ")).toBe(true);
  });
  it("case-insensitive substring across fields", () => {
    expect(textMatch(["Customer HQ", "online"], "hq")).toBe(true);
    expect(textMatch(["Customer HQ", "online"], "ONLINE")).toBe(true);
    expect(textMatch(["Customer HQ", "online"], "line")).toBe(true);
  });
  it("skips null/undefined fields", () => {
    expect(textMatch([null, undefined, "ada@x.co"], "ada")).toBe(true);
    expect(textMatch([null, undefined], "ada")).toBe(false);
  });
  it("no match → false", () => {
    expect(textMatch(["Customer HQ", "online"], "zzz")).toBe(false);
  });
});
