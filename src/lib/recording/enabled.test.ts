import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recordingEnabled } from "./enabled";

const ORIGINAL = process.env.RECORDING_ENABLED;

beforeEach(() => { delete process.env.RECORDING_ENABLED; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.RECORDING_ENABLED;
  else process.env.RECORDING_ENABLED = ORIGINAL;
});

describe("recordingEnabled", () => {
  it.each(["1", "true", "on", "TRUE", "On", "  true  "])("true for %j", (v) => {
    process.env.RECORDING_ENABLED = v;
    expect(recordingEnabled()).toBe(true);
  });

  it.each([undefined, "", "0", "false", "off", "yes"])("false for %j", (v) => {
    if (v === undefined) delete process.env.RECORDING_ENABLED;
    else process.env.RECORDING_ENABLED = v;
    expect(recordingEnabled()).toBe(false);
  });
});
