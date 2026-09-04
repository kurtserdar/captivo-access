import { describe, it, expect, afterEach } from "vitest";
import { shouldSkipSync, directorySyncThrottleMs } from "./sync-throttle";
import { directoryResolveTimeoutMs } from "@/lib/connector/dataplane";

describe("shouldSkipSync", () => {
  const now = 1_000_000;
  it("skips when verified within the window", () => {
    expect(shouldSkipSync(new Date(now - 60_000), now, 300_000)).toBe(true);
  });
  it("does not skip once the window has elapsed", () => {
    expect(shouldSkipSync(new Date(now - 400_000), now, 300_000)).toBe(false);
  });
  it("does not skip when never verified", () => {
    expect(shouldSkipSync(null, now, 300_000)).toBe(false);
    expect(shouldSkipSync(undefined, now, 300_000)).toBe(false);
  });
  it("never skips when throttling is disabled (0)", () => {
    expect(shouldSkipSync(new Date(now), now, 0)).toBe(false);
  });
});

describe("env-configured tunables", () => {
  afterEach(() => {
    delete process.env.DIRECTORY_SYNC_THROTTLE_SECONDS;
    delete process.env.DIRECTORY_RESOLVE_TIMEOUT_MS;
  });
  it("defaults", () => {
    expect(directorySyncThrottleMs()).toBe(300_000);
    expect(directoryResolveTimeoutMs()).toBe(4000);
  });
  it("reads env overrides", () => {
    process.env.DIRECTORY_SYNC_THROTTLE_SECONDS = "60";
    expect(directorySyncThrottleMs()).toBe(60_000);
    process.env.DIRECTORY_RESOLVE_TIMEOUT_MS = "2500";
    expect(directoryResolveTimeoutMs()).toBe(2500);
  });
  it("throttle 0 disables", () => {
    process.env.DIRECTORY_SYNC_THROTTLE_SECONDS = "0";
    expect(directorySyncThrottleMs()).toBe(0);
  });
});
