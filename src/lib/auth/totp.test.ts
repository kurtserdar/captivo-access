import { describe, it, expect } from "vitest";
import { generateTotpSecret, verifyTotp, totpKeyUri } from "./totp";
// otplib v13: no old `authenticator` singleton (functional API — generateSync/verifySync).
import { generateSync } from "otplib";

describe("totp", () => {
  it("generates a base32 secret", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
  });
  it("verifies a valid code, rejects an invalid one", () => {
    const s = generateTotpSecret();
    const code = generateSync({ secret: s });
    expect(verifyTotp(code, s)).toBe(true);
    expect(verifyTotp("000000", s)).toBe(false);
  });
  it("keyUri is in otpauth format", () => {
    const uri = totpKeyUri(generateTotpSecret(), "user@x.com", "Captivo Access");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("Captivo%20Access");
  });
});
