import { describe, it, expect } from "vitest";
import { charKeysym, KEY } from "./keysyms";

describe("keysyms", () => {
  it("maps printable ASCII to its code point", () => {
    expect(charKeysym("a")).toBe(0x61);
    expect(charKeysym("A")).toBe(0x41);
    expect(charKeysym("1")).toBe(0x31);
    expect(charKeysym(" ")).toBe(0x20);
  });
  it("has correct special keysyms", () => {
    expect(KEY.esc).toBe(0xff1b);
    expect(KEY.tab).toBe(0xff09);
    expect(KEY.enter).toBe(0xff0d);
    expect(KEY.del).toBe(0xffff);
    expect(KEY.ctrl).toBe(0xffe3);
    expect(KEY.alt).toBe(0xffe9);
    expect(KEY.left).toBe(0xff51);
    expect(KEY.f1).toBe(0xffbe);
  });
});
