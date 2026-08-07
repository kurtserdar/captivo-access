import { describe, it, expect } from "vitest";
import { compareSemver, isConnectorOutdated, isUpdateAvailable } from "./semver";

describe("compareSemver", () => {
  it("orders versions and strips a leading v", () => {
    expect(compareSemver("0.9.0", "0.9.1")).toBe(-1);
    expect(compareSemver("v0.10.0", "0.9.9")).toBe(1);
    expect(compareSemver("1.2.3", "v1.2.3")).toBe(0);
  });
  it("ignores a pre-release/build suffix", () => {
    expect(compareSemver("0.9.0-rc1", "0.9.0")).toBe(0);
  });
  it("returns null when either side isn't a plain semver", () => {
    expect(compareSemver("dev", "0.9.0")).toBeNull();
    expect(compareSemver("0.9.0", "")).toBeNull();
    expect(compareSemver("garbage", "1.0.0")).toBeNull();
  });
});

describe("isConnectorOutdated / isUpdateAvailable", () => {
  it("flags an older connector, not an equal or newer one", () => {
    expect(isConnectorOutdated("0.8.5", "0.9.0")).toBe(true);
    expect(isConnectorOutdated("0.9.0", "0.9.0")).toBe(false);
    expect(isConnectorOutdated(null, "0.9.0")).toBe(false);
    expect(isConnectorOutdated("0.8.0", "dev")).toBe(false); // unknown manager → no badge
  });
  it("flags an available upstream update, not equal/older", () => {
    expect(isUpdateAvailable("0.9.1", "0.9.0")).toBe(true);
    expect(isUpdateAvailable("0.9.0", "0.9.0")).toBe(false);
    expect(isUpdateAvailable(null, "0.9.0")).toBe(false);
  });
});
