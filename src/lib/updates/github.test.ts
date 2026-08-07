import { describe, it, expect } from "vitest";
import { parseLatestRelease } from "./github";

describe("parseLatestRelease", () => {
  it("strips a leading v from tag_name and keeps html_url", () => {
    expect(parseLatestRelease({ tag_name: "v0.9.1", html_url: "https://github.com/x/y/releases/tag/v0.9.1" }))
      .toEqual({ latestVersion: "0.9.1", latestUrl: "https://github.com/x/y/releases/tag/v0.9.1" });
  });
  it("returns null version for a non-semver tag", () => {
    expect(parseLatestRelease({ tag_name: "nightly", html_url: "u" }).latestVersion).toBeNull();
  });
  it("handles malformed bodies", () => {
    expect(parseLatestRelease(null)).toEqual({ latestVersion: null, latestUrl: null });
    expect(parseLatestRelease({})).toEqual({ latestVersion: null, latestUrl: null });
  });
});
