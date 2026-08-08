import { describe, it, expect } from "vitest";
import { hasFullSnapshot } from "./snapshot";

describe("hasFullSnapshot", () => {
  it("is true when a type-2 FullSnapshot event is present", () => {
    expect(hasFullSnapshot([{ type: 4 }, { type: 2, data: {} }, { type: 3 }])).toBe(true);
  });
  it("is false for a snapshot-less incremental-only stream", () => {
    expect(hasFullSnapshot([{ type: 3 }, { type: 3 }, { type: 4 }])).toBe(false);
  });
  it("is false for an empty array", () => {
    expect(hasFullSnapshot([])).toBe(false);
  });
  it("ignores non-object entries", () => {
    expect(hasFullSnapshot([null, 2, "type", undefined])).toBe(false);
  });
});
