import { describe, it, expect, afterEach } from "vitest";
import { isolationEnabled } from "./enabled";

afterEach(() => { delete process.env.ISOLATED_ENABLED; });

describe("isolationEnabled", () => {
  it("off by default and for falsy values", () => {
    expect(isolationEnabled()).toBe(false);
    process.env.ISOLATED_ENABLED = "0"; expect(isolationEnabled()).toBe(false);
  });
  it("on for 1/true/on", () => {
    for (const v of ["1", "true", "on", "ON"]) { process.env.ISOLATED_ENABLED = v; expect(isolationEnabled()).toBe(true); }
  });
});
