import { KEY, type KeyDef } from "./keysyms";

export type ModState = { ctrl: boolean; alt: boolean; shift: boolean };
export const EMPTY_MODS: ModState = { ctrl: false, alt: false, shift: false };

type KeyEvent = { keysym: number; pressed: boolean };

// Sticky-modifier machine. Pressing a modifier toggles it (armed, no remote event).
// Pressing any other key chords the armed modifiers around it: armed-mods down →
// key down → key up → armed-mods up, then clears all armed modifiers.
export function applyKey(state: ModState, key: KeyDef): { events: KeyEvent[]; next: ModState } {
  if (key.modifier) {
    return { events: [], next: { ...state, [key.modifier]: !state[key.modifier] } };
  }
  const mods: number[] = [];
  if (state.ctrl) mods.push(KEY.ctrl);
  if (state.alt) mods.push(KEY.alt);
  if (state.shift) mods.push(KEY.shift);
  const events: KeyEvent[] = [
    ...mods.map((m) => ({ keysym: m, pressed: true })),
    { keysym: key.keysym, pressed: true },
    { keysym: key.keysym, pressed: false },
    ...mods.reverse().map((m) => ({ keysym: m, pressed: false })),
  ];
  return { events, next: EMPTY_MODS };
}
