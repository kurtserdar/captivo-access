import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock only the tenant-settings resolver (the DB-backed dependency); the capability
// master is driven through the real env-reading recordingEnabled().
const resolvedRecordingMode = vi.fn<() => Promise<string>>();
vi.mock("@/lib/settings/platform", () => ({
  resolvedRecordingMode: () => resolvedRecordingMode(),
}));

import { effectiveSiteRecording } from "./effective";

const ORIGINAL = process.env.RECORDING_ENABLED;

beforeEach(() => {
  process.env.RECORDING_ENABLED = "1"; // capability on unless a case turns it off
  resolvedRecordingMode.mockReset();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.RECORDING_ENABLED;
  else process.env.RECORDING_ENABLED = ORIGINAL;
});

describe("effectiveSiteRecording", () => {
  it("capability off → never records, regardless of mode/toggle", async () => {
    process.env.RECORDING_ENABLED = "0"; // explicitly disable — capability now defaults on
    resolvedRecordingMode.mockResolvedValue("required");
    expect(await effectiveSiteRecording(true)).toBe(false);
    expect(await effectiveSiteRecording(false)).toBe(false);
  });

  it("required → always records when capability on", async () => {
    resolvedRecordingMode.mockResolvedValue("required");
    expect(await effectiveSiteRecording(false)).toBe(true);
    expect(await effectiveSiteRecording(true)).toBe(true);
  });

  it("off → never records even when capability on", async () => {
    resolvedRecordingMode.mockResolvedValue("off");
    expect(await effectiveSiteRecording(true)).toBe(false);
    expect(await effectiveSiteRecording(false)).toBe(false);
  });

  it("per_resource → follows the resource toggle", async () => {
    resolvedRecordingMode.mockResolvedValue("per_resource");
    expect(await effectiveSiteRecording(true)).toBe(true);
    expect(await effectiveSiteRecording(false)).toBe(false);
  });
});
