import { describe, it, expect } from "vitest";
import { clipboardCaps } from "./clipboard-caps";

describe("clipboardCaps", () => {
  it("allow → copy-out and paste-in", () => {
    expect(clipboardCaps("allow")).toEqual({ allowCopyOut: true, allowPasteIn: true });
  });
  it("no_copy → paste-in only", () => {
    expect(clipboardCaps("no_copy")).toEqual({ allowCopyOut: false, allowPasteIn: true });
  });
  it("no_paste → copy-out only", () => {
    expect(clipboardCaps("no_paste")).toEqual({ allowCopyOut: true, allowPasteIn: false });
  });
  it("none → neither direction", () => {
    expect(clipboardCaps("none")).toEqual({ allowCopyOut: false, allowPasteIn: false });
  });
  it("unknown value falls back to permissive (matches default 'allow')", () => {
    expect(clipboardCaps("weird")).toEqual({ allowCopyOut: true, allowPasteIn: true });
  });
});
