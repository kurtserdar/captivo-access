import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildTimeStampRequest, parseTimeStampResponse, verifyTimeStampToken } from "./rfc3161";

const DIR = join(__dirname, "rfc3161.fixtures");
const response = readFileSync(join(DIR, "response.tsr"));
// data.bin is the preimage; digest.hex is sha256(data.bin) — the token's imprint.
const preimage = readFileSync(join(DIR, "data.bin"));
const digest = Buffer.from(readFileSync(join(DIR, "digest.hex"), "utf8").trim(), "hex");

describe("rfc3161", () => {
  it("builds a DER TimeStampReq that starts with a SEQUENCE tag", () => {
    const req = buildTimeStampRequest(digest);
    expect(req.length).toBeGreaterThan(0);
    expect(req[0]).toBe(0x30); // ASN.1 SEQUENCE
  });

  it("fixture sanity: digest.hex equals sha256(data.bin)", () => {
    expect(createHash("sha256").update(preimage).digest("hex")).toBe(digest.toString("hex"));
  });

  it("parses a granted response into a token + genTime", () => {
    const { token, genTime } = parseTimeStampResponse(response);
    expect(token.length).toBeGreaterThan(0);
    expect(genTime).toBeInstanceOf(Date);
    expect(genTime.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("verifies the token against the correct preimage", async () => {
    const { token } = parseTimeStampResponse(response);
    const r = await verifyTimeStampToken(token, preimage);
    expect(r.ok).toBe(true);
    expect(r.genTime).toBeInstanceOf(Date);
  });

  it("rejects the token against a wrong preimage", async () => {
    const { token } = parseTimeStampResponse(response);
    const r = await verifyTimeStampToken(token, Buffer.from("not-the-preimage"));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("imprint_mismatch");
  });
});
