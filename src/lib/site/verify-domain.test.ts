import { describe, expect, it } from "vitest";
import { verifyDecision } from "./verify-domain";

describe("verifyDecision", () => {
  it("ok when resolved contains the expected IP", () => {
    expect(verifyDecision("1.2.3.4", ["1.2.3.4"])).toBe("ok");
  });

  it("mismatch when it resolves elsewhere", () => {
    expect(verifyDecision("1.2.3.4", ["9.9.9.9"])).toBe("mismatch");
  });

  it("missing when it doesn't resolve", () => {
    expect(verifyDecision("1.2.3.4", [])).toBe("missing");
  });
});
