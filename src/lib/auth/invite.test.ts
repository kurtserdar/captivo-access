import { describe, it, expect } from "vitest";
import { createInvite } from "./invite";

describe("createInvite signature", () => {
  it("accepts a call with no createdById (platform-provisioned)", () => {
    // Type-only: this must compile. createdById is optional/nullable.
    const call = () =>
      createInvite({ email: "a@b.co", name: "A", role: "ADMIN" });
    expect(typeof call).toBe("function");
  });
});
