import { describe, it, expect } from "vitest";
import { recordToggleLock } from "./mode";

describe("recordToggleLock", () => {
  it("per_resource → not locked, toggle free", () => {
    expect(recordToggleLock("per_resource")).toEqual({ locked: false, forcedValue: null });
  });
  it("required → locked on", () => {
    expect(recordToggleLock("required")).toEqual({ locked: true, forcedValue: true });
  });
  it("off → locked off", () => {
    expect(recordToggleLock("off")).toEqual({ locked: true, forcedValue: false });
  });
});
