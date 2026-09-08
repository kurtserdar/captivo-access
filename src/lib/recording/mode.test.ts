import { describe, it, expect } from "vitest";
import { effectiveRecordSessions } from "./mode";

describe("effectiveRecordSessions", () => {
  it("off → never records", () => {
    expect(effectiveRecordSessions("off", true)).toBe(false);
    expect(effectiveRecordSessions("off", false)).toBe(false);
  });
  it("required → always records", () => {
    expect(effectiveRecordSessions("required", false)).toBe(true);
    expect(effectiveRecordSessions("required", true)).toBe(true);
  });
  it("per_resource → follows the resource toggle", () => {
    expect(effectiveRecordSessions("per_resource", true)).toBe(true);
    expect(effectiveRecordSessions("per_resource", false)).toBe(false);
  });
  it("unknown mode → safe default (per-resource behavior)", () => {
    expect(effectiveRecordSessions("bogus", true)).toBe(true);
    expect(effectiveRecordSessions("bogus", false)).toBe(false);
  });
});
