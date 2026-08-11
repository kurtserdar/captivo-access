import { describe, it, expect, beforeAll } from "vitest";
import { encryptBytes, decryptBytes } from "./crypto";

beforeAll(() => {
  // 32-byte hex key for AES-256-GCM.
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});

describe("encryptBytes/decryptBytes", () => {
  it("round-trips arbitrary binary data", () => {
    const raw = Buffer.from([0, 1, 2, 255, 254, 10, 13, 0, 128]);
    const enc = encryptBytes(raw);
    expect(enc.equals(raw)).toBe(false); // actually encrypted
    expect(decryptBytes(enc).equals(raw)).toBe(true);
  });

  it("produces a fresh IV each call (ciphertext differs)", () => {
    const raw = Buffer.from("same input");
    expect(encryptBytes(raw).equals(encryptBytes(raw))).toBe(false);
  });

  it("throws on a tampered payload", () => {
    const enc = encryptBytes(Buffer.from("secret"));
    enc[enc.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptBytes(enc)).toThrow();
  });

  it("throws on a too-short payload", () => {
    expect(() => decryptBytes(Buffer.alloc(10))).toThrow();
  });
});
