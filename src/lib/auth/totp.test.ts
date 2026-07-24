import { describe, it, expect } from "vitest";
import { generateTotpSecret, verifyTotp, totpKeyUri } from "./totp";
// otplib v13: eski `authenticator` singleton yok (functional API — generateSync/verifySync).
import { generateSync } from "otplib";

describe("totp", () => {
  it("secret base32 üretir", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
  });
  it("geçerli kodu doğrular, yanlışı reddeder", () => {
    const s = generateTotpSecret();
    const code = generateSync({ secret: s });
    expect(verifyTotp(code, s)).toBe(true);
    expect(verifyTotp("000000", s)).toBe(false);
  });
  it("keyUri otpauth formatında", () => {
    const uri = totpKeyUri(generateTotpSecret(), "user@x.com", "Captivo Access");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("Captivo%20Access");
  });
});
