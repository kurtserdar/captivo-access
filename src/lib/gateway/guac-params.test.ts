import { describe, it, expect } from "vitest";
import { parseGuacParams, resolveGuacParams, toGuacArgs } from "./guac-params";

describe("parseGuacParams", () => {
  it("keeps curated valid keys and drops the rest", () => {
    expect(parseGuacParams({
      serverLayout: "tr-tr-qwerty", colorDepth: 16, enableWallpaper: true,
      serverLayout2: "x", colorDepth99: 99, evil: "rm -rf",
    })).toEqual({ serverLayout: "tr-tr-qwerty", colorDepth: 16, enableWallpaper: true });
  });
  it("rejects an unknown layout and out-of-range colour depth", () => {
    expect(parseGuacParams({ serverLayout: "xx-yy-zzz", colorDepth: 99 })).toEqual({});
  });
  it("returns {} for non-objects", () => {
    expect(parseGuacParams(null)).toEqual({});
    expect(parseGuacParams("nope")).toEqual({});
  });
});

describe("resolveGuacParams", () => {
  it("prefers the resource value, falls back to policy, leaves unset undefined", () => {
    const r = resolveGuacParams({ colorDepth: 24 }, { serverLayout: "de-de-qwertz", colorDepth: 8 });
    expect(r.colorDepth).toBe(24);               // resource wins
    expect(r.serverLayout).toBe("de-de-qwertz"); // policy fallback
    expect(r.enableWallpaper).toBeUndefined();   // neither set
  });
});

describe("toGuacArgs", () => {
  it("emits set/true params and maps clipboardMode", () => {
    expect(toGuacArgs({ serverLayout: "tr-tr-qwerty", colorDepth: 16, enableWallpaper: true, enableTheming: false }, "no_copy"))
      .toEqual({ "server-layout": "tr-tr-qwerty", "color-depth": "16", "enable-wallpaper": "true", "disable-copy": "true" });
  });
  it("clipboardMode none blocks both; allow blocks neither", () => {
    expect(toGuacArgs({}, "none")).toEqual({ "disable-copy": "true", "disable-paste": "true" });
    expect(toGuacArgs({}, "allow")).toEqual({});
  });
});
