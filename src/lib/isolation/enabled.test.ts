import { describe, it, expect, afterEach } from "vitest";
import { isolationEnabled } from "./enabled";

afterEach(() => { delete process.env.ISOLATED_ENABLED; });

describe("isolationEnabled", () => {
  it("on by default when unset", () => {
    delete process.env.ISOLATED_ENABLED;
    expect(isolationEnabled()).toBe(true);
  });
  it("off for explicit falsy values", () => {
    for (const v of ["0", "false", "off"]) { process.env.ISOLATED_ENABLED = v; expect(isolationEnabled()).toBe(false); }
  });
  it("on for 1/true/on", () => {
    for (const v of ["1", "true", "on", "ON"]) { process.env.ISOLATED_ENABLED = v; expect(isolationEnabled()).toBe(true); }
  });
});
