import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { anchorPreimage, anchorDigest, shouldAnchor } from "./anchor";

describe("anchorPreimage", () => {
  it("is the utf8 bytes of `${seq}:${hash}`", () => {
    expect(anchorPreimage(42n, "abc123").toString("utf8")).toBe("42:abc123");
  });
});

describe("anchorDigest", () => {
  it("is sha256 of the preimage", () => {
    const d = anchorDigest(42n, "abc123");
    const expected = createHash("sha256").update("42:abc123").digest();
    expect(d.equals(expected)).toBe(true);
  });
});

describe("shouldAnchor", () => {
  it("skips an empty chain (seq 0)", () => {
    expect(shouldAnchor({ lastSeq: 0n, lastHash: "" }, null)).toBe(false);
  });
  it("anchors when no anchor exists yet", () => {
    expect(shouldAnchor({ lastSeq: 5n, lastHash: "h5" }, null)).toBe(true);
  });
  it("skips when the head is unchanged since the last anchor", () => {
    expect(shouldAnchor({ lastSeq: 5n, lastHash: "h5" }, { anchoredSeq: 5n, anchoredHash: "h5" })).toBe(false);
  });
  it("anchors when the head advanced", () => {
    expect(shouldAnchor({ lastSeq: 6n, lastHash: "h6" }, { anchoredSeq: 5n, anchoredHash: "h5" })).toBe(true);
  });
  it("anchors when seq is equal but hash differs (rewrite in place)", () => {
    expect(shouldAnchor({ lastSeq: 5n, lastHash: "hX" }, { anchoredSeq: 5n, anchoredHash: "h5" })).toBe(true);
  });
});
