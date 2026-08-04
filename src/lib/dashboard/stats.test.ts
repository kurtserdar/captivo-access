import { describe, it, expect } from "vitest";
import { healthTone, siteStatePill } from "./stats";

describe("healthTone", () => {
  it("no sites -> neutral", () => expect(healthTone(0, 0)).toBe("neutral"));
  it("all reachable -> ok", () => expect(healthTone(4, 4)).toBe("ok"));
  it("none reachable -> danger", () => expect(healthTone(0, 3)).toBe("danger"));
  it("some down -> warn", () => expect(healthTone(3, 4)).toBe("warn"));
});

describe("siteStatePill", () => {
  it("true -> Reachable/ok", () => expect(siteStatePill(true)).toEqual({ label: "Reachable", tone: "ok" }));
  it("false -> Down/danger", () => expect(siteStatePill(false)).toEqual({ label: "Down", tone: "danger" }));
  it("null -> Unknown/neutral", () => expect(siteStatePill(null)).toEqual({ label: "Unknown", tone: "neutral" }));
});
