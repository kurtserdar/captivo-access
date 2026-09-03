import { describe, it, expect } from "vitest";
import { coerceClipboardDefault, CLIPBOARD_MODES } from "./platform";

describe("coerceClipboardDefault", () => {
  it("returns a valid stored mode unchanged", () => {
    for (const m of CLIPBOARD_MODES) expect(coerceClipboardDefault(m)).toBe(m);
  });
  it("falls back to allow when null", () => {
    expect(coerceClipboardDefault(null)).toBe("allow");
  });
  it("falls back to allow on an unknown value", () => {
    expect(coerceClipboardDefault("garbage")).toBe("allow");
    expect(coerceClipboardDefault("inherit")).toBe("allow");
  });
});
