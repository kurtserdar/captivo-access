import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "./crypto";

beforeAll(() => { process.env.ENCRYPTION_KEY = "a".repeat(64); }); // 32 byte hex

describe("crypto AES-256-GCM", () => {
  it("round-trip", () => {
    const p = "gizli-totp-secret-ABC123";
    const c = encrypt(p);
    expect(c).not.toContain(p);
    expect(decrypt(c)).toBe(p);
  });
  it("her şifreleme farklı ciphertext (rastgele IV)", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
  it("bozuk payload → throw", () => {
    expect(() => decrypt("bozuk")).toThrow();
  });
  it("yanlış anahtar → throw (tag doğrulaması)", () => {
    const c = encrypt("y");
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(() => decrypt(c)).toThrow();
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });
});
