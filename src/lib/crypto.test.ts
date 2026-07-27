import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "./crypto";

beforeAll(() => { process.env.ENCRYPTION_KEY = "a".repeat(64); }); // 32-byte hex

describe("crypto AES-256-GCM", () => {
  it("round-trip", () => {
    const p = "plaintext-totp-secret-ABC123";
    const c = encrypt(p);
    expect(c).not.toContain(p);
    expect(decrypt(c)).toBe(p);
  });
  it("each encryption produces different ciphertext (random IV)", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
  it("corrupted payload → throw", () => {
    expect(() => decrypt("corrupted")).toThrow();
  });
  it("wrong key → throw (tag verification)", () => {
    const c = encrypt("y");
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(() => decrypt(c)).toThrow();
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });
});
