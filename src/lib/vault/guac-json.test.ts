import { describe, it, expect } from "vitest";
import { createDecipheriv, createHmac } from "node:crypto";
import { buildAuthData, type GuacAuthDoc } from "./guac-json";

const KEY = "00112233445566778899aabbccddeeff"; // 16 bytes / 32 hex chars
const DOC: GuacAuthDoc = {
  username: "vendor@example.com",
  expires: 1893456000000,
  connections: {
    "Prod DB": { protocol: "ssh", parameters: { hostname: "10.0.0.5", port: "22", username: "root", password: "s3cret" } },
  },
};

// Mirror of what guacamole-auth-json does to decode the blob, to prove format.
function decode(secretHex: string, data: string) {
  const key = Buffer.from(secretHex, "hex");
  const ct = Buffer.from(data, "base64");
  const d = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  const signed = Buffer.concat([d.update(ct), d.final()]);
  const sig = signed.subarray(0, 32);
  const json = signed.subarray(32);
  const expected = createHmac("sha256", key).update(json).digest();
  return { sigOk: sig.equals(expected), doc: JSON.parse(json.toString("utf8")) };
}

describe("buildAuthData", () => {
  it("produces a blob that decrypts, verifies its HMAC, and round-trips the doc", () => {
    const data = buildAuthData(KEY, DOC);
    const { sigOk, doc } = decode(KEY, data);
    expect(sigOk).toBe(true);
    expect(doc).toEqual(DOC);
  });
  it("rejects a wrong-length secret", () => {
    expect(() => buildAuthData("abcd", DOC)).toThrow();
  });
});
