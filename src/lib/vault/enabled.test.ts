import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { vaultEnabled } from "./enabled";

const ORIGINAL = process.env.VAULT_ENABLED;
beforeEach(() => {
  delete process.env.VAULT_ENABLED;
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.VAULT_ENABLED;
  else process.env.VAULT_ENABLED = ORIGINAL;
});

describe("vaultEnabled", () => {
  it("is on by default", () => expect(vaultEnabled()).toBe(true));
  it("is on for 1/true/on (case-insensitive)", () => {
    for (const v of ["1", "true", "on", "ON", "True"]) {
      process.env.VAULT_ENABLED = v;
      expect(vaultEnabled()).toBe(true);
    }
  });
  it("is off for explicit falsy values", () => {
    for (const v of ["0", "false", "off", "no"]) {
      process.env.VAULT_ENABLED = v;
      expect(vaultEnabled()).toBe(false);
    }
  });
});
