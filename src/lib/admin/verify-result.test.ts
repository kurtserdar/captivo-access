import { describe, it, expect } from "vitest";
import { verifyResultFields } from "./verify-result";

const now = new Date("2026-08-07T12:00:00.000Z");

describe("verifyResultFields", () => {
  it("on success stamps the time, ok=true, and null detail", () => {
    expect(verifyResultFields(true, "ignored", now)).toEqual({
      lastVerifiedAt: now,
      lastVerifiedOk: true,
      lastVerifiedDetail: null,
    });
  });
  it("on failure preserves the detail", () => {
    expect(verifyResultFields(false, "unreachable", now)).toEqual({
      lastVerifiedAt: now,
      lastVerifiedOk: false,
      lastVerifiedDetail: "unreachable",
    });
  });
  it("on failure with no detail stores null", () => {
    expect(verifyResultFields(false, null, now).lastVerifiedDetail).toBeNull();
  });
});
