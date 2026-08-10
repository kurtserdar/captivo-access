import { describe, it, expect } from "vitest";
import { verifyOneAnchor, type VerifyDeps } from "./anchor-verify";

const anchor = {
  id: "a1",
  anchoredSeq: 5n,
  anchoredHash: "h5",
  token: Buffer.from("x"),
  genTime: new Date("2026-01-01T00:00:00Z"),
};

const okToken: VerifyDeps["tokenCheck"] = async () => ({ ok: true, genTime: new Date("2026-01-01T00:00:00Z") });
const badToken: VerifyDeps["tokenCheck"] = async () => ({ ok: false, genTime: null, reason: "signature_invalid" });

describe("verifyOneAnchor", () => {
  it("passes when the token verifies and the chain still holds the anchored hash", async () => {
    const v = await verifyOneAnchor(anchor, "h5", { tokenCheck: okToken });
    expect(v).toMatchObject({ id: "a1", ok: true, beyondRetention: false, reason: null });
  });

  it("flags a chain mismatch (rewrite) when the event no longer hashes to the anchored value", async () => {
    const v = await verifyOneAnchor(anchor, "DIFFERENT", { tokenCheck: okToken });
    expect(v).toMatchObject({ ok: false, reason: "chain_mismatch" });
  });

  it("reports beyond-retention when the anchored seq is gone", async () => {
    const v = await verifyOneAnchor(anchor, null, { tokenCheck: okToken });
    expect(v).toMatchObject({ ok: true, beyondRetention: true, reason: null });
  });

  it("fails when the token itself is invalid, regardless of the chain", async () => {
    const v = await verifyOneAnchor(anchor, "h5", { tokenCheck: badToken });
    expect(v).toMatchObject({ ok: false, reason: "token_signature_invalid" });
  });
});
