import { describe, it, expect, afterEach } from "vitest";
import { nativeGatewayEnabled } from "./native";

afterEach(() => { delete process.env.NATIVE_GATEWAY; });

describe("nativeGatewayEnabled", () => {
  it("unset → true (on by default)", () => { delete process.env.NATIVE_GATEWAY; expect(nativeGatewayEnabled()).toBe(true); });
  it("explicit off → false", () => { process.env.NATIVE_GATEWAY = "0"; expect(nativeGatewayEnabled()).toBe(false); });
  it("explicit on → true", () => { process.env.NATIVE_GATEWAY = "true"; expect(nativeGatewayEnabled()).toBe(true); });
});
