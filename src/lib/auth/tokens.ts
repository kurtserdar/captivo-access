import { randomBytes, createHash } from "node:crypto";
import { hash as argon2hash, verify as argon2verify } from "@node-rs/argon2";

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Promise<string> {
  return argon2hash(token);
}

export function verifyTokenHash(token: string, hash: string): Promise<boolean> {
  return argon2verify(hash, token).catch(() => false);
}

/** For session tokens — the token is already 32B random (high entropy) → fast sha256 is enough. */
export function sha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
