import { describe, it, expect } from "vitest";
import { livePillView } from "./live-pill";

describe("livePillView", () => {
  it("zero → Idle, not live", () => {
    expect(livePillView(0)).toEqual({ label: "Idle", live: false });
  });
  it("positive → 'N live', live", () => {
    expect(livePillView(3)).toEqual({ label: "3 live", live: true });
    expect(livePillView(1)).toEqual({ label: "1 live", live: true });
  });
  it("floors fractional counts", () => {
    expect(livePillView(2.9)).toEqual({ label: "2 live", live: true });
  });
  it("negative or non-finite → Idle", () => {
    expect(livePillView(-1)).toEqual({ label: "Idle", live: false });
    expect(livePillView(Number.NaN)).toEqual({ label: "Idle", live: false });
  });
});
