import { describe, it, expect } from "vitest";
import { generateToken, hashToken, verifyTokenHash, sha256 } from "./tokens";

describe("tokens", () => {
  it("generateToken is high-entropy, url-safe, unique", () => {
    const a = generateToken(), b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32B base64url
  });
  it("argon2 hash + verify", async () => {
    const t = generateToken();
    const h = await hashToken(t);
    expect(h).not.toBe(t);
    expect(await verifyTokenHash(t, h)).toBe(true);
    expect(await verifyTokenHash("wrong", h)).toBe(false);
  });
  it("sha256 is deterministic + hex", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });
});
