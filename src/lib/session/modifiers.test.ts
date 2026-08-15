import { describe, it, expect } from "vitest";
import { applyKey, EMPTY_MODS } from "./modifiers";
import { KEY, charKeysym } from "./keysyms";

describe("applyKey (sticky modifiers)", () => {
  it("arms a modifier without emitting events", () => {
    const r = applyKey(EMPTY_MODS, { label: "Ctrl", keysym: KEY.ctrl, modifier: "ctrl" });
    expect(r.events).toEqual([]);
    expect(r.next.ctrl).toBe(true);
  });
  it("a plain key with no mods sends down+up", () => {
    const r = applyKey(EMPTY_MODS, { label: "a", keysym: charKeysym("a") });
    expect(r.events).toEqual([{ keysym: 0x61, pressed: true }, { keysym: 0x61, pressed: false }]);
    expect(r.next).toEqual(EMPTY_MODS);
  });
  it("chords armed modifiers then releases them (Ctrl+Alt+Del)", () => {
    let s = applyKey(EMPTY_MODS, { label: "Ctrl", keysym: KEY.ctrl, modifier: "ctrl" }).next;
    s = applyKey(s, { label: "Alt", keysym: KEY.alt, modifier: "alt" }).next;
    const r = applyKey(s, { label: "Del", keysym: KEY.del });
    expect(r.events).toEqual([
      { keysym: KEY.ctrl, pressed: true },
      { keysym: KEY.alt, pressed: true },
      { keysym: KEY.del, pressed: true },
      { keysym: KEY.del, pressed: false },
      { keysym: KEY.alt, pressed: false },
      { keysym: KEY.ctrl, pressed: false },
    ]);
    expect(r.next).toEqual(EMPTY_MODS);
  });
  it("toggles a modifier off if pressed twice", () => {
    let s = applyKey(EMPTY_MODS, { label: "Shift", keysym: KEY.shift, modifier: "shift" }).next;
    s = applyKey(s, { label: "Shift", keysym: KEY.shift, modifier: "shift" }).next;
    expect(s.shift).toBe(false);
  });
});
