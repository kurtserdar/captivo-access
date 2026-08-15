import { describe, it, expect } from "vitest";
import { isolatedDims } from "./dims";

describe("isolatedDims", () => {
  it("non-touch uses the screen size clamped 1024..2560 / 640..1600", () => {
    expect(isolatedDims(false, 1920, 1080, 1440, 900)).toEqual({ w: 1920, h: 1080 });
    expect(isolatedDims(false, 800, 600, 800, 600)).toEqual({ w: 1024, h: 640 });
    expect(isolatedDims(false, 4000, 3000, 4000, 3000)).toEqual({ w: 2560, h: 1600 });
  });
  it("touch uses the viewport clamped 360..820 / 480..1180", () => {
    expect(isolatedDims(true, 390, 844, 390, 844)).toEqual({ w: 390, h: 844 });
    expect(isolatedDims(true, 320, 400, 320, 400)).toEqual({ w: 360, h: 480 });
    expect(isolatedDims(true, 1200, 2000, 1200, 2000)).toEqual({ w: 820, h: 1180 });
  });
});
