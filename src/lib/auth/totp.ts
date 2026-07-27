// otplib v13: the old `authenticator` singleton was removed — using the sync functional API
// (generateSecret, generateSync, verifySync, generateURI). See node_modules/otplib/dist/functional.d.ts
import { generateSecret, verifySync, generateURI } from "otplib";

export function generateTotpSecret(): string {
  return generateSecret(); // base32
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return verifySync({ token, secret }).valid;
  } catch {
    return false;
  }
}

export function totpKeyUri(secret: string, accountName: string, issuer: string): string {
  return generateURI({ issuer, label: accountName, secret });
}
