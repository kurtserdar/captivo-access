import { createHmac, createCipheriv } from "node:crypto";

export type GuacAuthDoc = {
  username: string;
  expires: number; // epoch millis; keep short-lived
  connections: Record<string, { protocol: string; parameters: Record<string, string> }>;
};

// Produces the base64 `data` blob the guacamole-auth-json extension accepts:
// base64( AES-128-CBC( HMAC-SHA256(json) ‖ json ) ), key = 16 bytes of the hex
// secret, IV = 16 zero bytes. The byte format must match the extension exactly.
export function buildAuthData(secretHex: string, doc: GuacAuthDoc): string {
  const key = Buffer.from(secretHex, "hex");
  if (key.length !== 16) throw new Error("JSON_SECRET_KEY must be 128-bit (32 hex chars)");
  const json = Buffer.from(JSON.stringify(doc), "utf8");
  const sig = createHmac("sha256", key).update(json).digest(); // 32 bytes
  const signed = Buffer.concat([sig, json]);
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  const ct = Buffer.concat([cipher.update(signed), cipher.final()]);
  return ct.toString("base64");
}
