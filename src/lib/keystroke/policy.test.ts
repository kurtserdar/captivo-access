import { describe, it, expect } from "vitest";
import { effectiveKeystrokeLogging } from "./policy";

const base = { recordingEnabled: true, recordSessions: true, siteFlag: false };

describe("effectiveKeystrokeLogging", () => {
  it("is false whenever recording is globally disabled", () => {
    for (const mode of ["off", "per_resource", "required"] as const) {
      expect(effectiveKeystrokeLogging({ ...base, recordingEnabled: false, siteFlag: true, mode })).toBe(false);
    }
  });

  it("is false whenever the site does not record sessions", () => {
    for (const mode of ["off", "per_resource", "required"] as const) {
      expect(effectiveKeystrokeLogging({ ...base, recordSessions: false, siteFlag: true, mode })).toBe(false);
    }
  });

  it("off → false even when the site flag is on", () => {
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: true, mode: "off" })).toBe(false);
  });

  it("required → true regardless of the site flag", () => {
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: false, mode: "required" })).toBe(true);
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: true, mode: "required" })).toBe(true);
  });

  it("per_resource → mirrors the site flag", () => {
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: true, mode: "per_resource" })).toBe(true);
    expect(effectiveKeystrokeLogging({ ...base, siteFlag: false, mode: "per_resource" })).toBe(false);
  });
});
