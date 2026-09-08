import { describe, it, expect, afterEach } from "vitest";
import { multiTenantEnabled } from "./enabled";

afterEach(() => { delete process.env.MULTI_TENANT; });

describe("multiTenantEnabled", () => {
  it("unset → false (self-host default)", () => { delete process.env.MULTI_TENANT; expect(multiTenantEnabled()).toBe(false); });
  it("explicit on → true", () => { process.env.MULTI_TENANT = "1"; expect(multiTenantEnabled()).toBe(true); });
  it("explicit off → false", () => { process.env.MULTI_TENANT = "off"; expect(multiTenantEnabled()).toBe(false); });
});
