import { describe, it, expect } from "vitest";
import { emailEnabledFromValue, NOTIF_EVENTS } from "./events";

describe("emailEnabledFromValue (default-on rule)", () => {
  it("enables when the value is true", () => expect(emailEnabledFromValue(true)).toBe(true));
  it("enables when the value is null (unset)", () => expect(emailEnabledFromValue(null)).toBe(true));
  it("enables when the value is undefined", () => expect(emailEnabledFromValue(undefined)).toBe(true));
  it("disables only when the value is exactly false", () => expect(emailEnabledFromValue(false)).toBe(false));
});

describe("NOTIF_EVENTS", () => {
  it("lists the three event keys", () => {
    expect(NOTIF_EVENTS.map((e) => e.key)).toEqual(["site_health", "access_requests", "access_decisions"]);
  });
});
