// X11 keysyms. Printable ASCII (0x20–0x7E) keysym == code point; special keys are
// 0xFFxx. Both guacamole sendKeyEvent and noVNC RFB.sendKey take X11 keysyms, so
// this one map drives both session stacks.
export function charKeysym(ch: string): number {
  return ch.charCodeAt(0);
}

export const KEY = {
  esc: 0xff1b, tab: 0xff09, backspace: 0xff08, enter: 0xff0d, caps: 0xffe5,
  shift: 0xffe1, ctrl: 0xffe3, alt: 0xffe9, super: 0xffeb, menu: 0xff67, space: 0x20,
  del: 0xffff, ins: 0xff63, home: 0xff50, end: 0xff57, pgup: 0xff55, pgdn: 0xff56,
  left: 0xff51, up: 0xff52, right: 0xff53, down: 0xff54,
  f1: 0xffbe, f2: 0xffbf, f3: 0xffc0, f4: 0xffc1, f5: 0xffc2, f6: 0xffc3,
  f7: 0xffc4, f8: 0xffc5, f9: 0xffc6, f10: 0xffc7, f11: 0xffc8, f12: 0xffc9,
} as const;

export type KeyDef = { label: string; keysym: number; modifier?: "ctrl" | "alt" | "shift"; width?: number };

// Layout rows (compact desktop keyboard). Printable keys use charKeysym; specials use KEY.
const row = (...keys: KeyDef[]) => keys;
export const KEYBOARD_ROWS: KeyDef[][] = [
  row({ label: "Esc", keysym: KEY.esc }, ...["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"].map((f) => ({ label: f, keysym: (KEY as Record<string, number>)[f.toLowerCase()] }))),
  row(...["`","1","2","3","4","5","6","7","8","9","0","-","="].map((c) => ({ label: c, keysym: charKeysym(c) })), { label: "Back", keysym: KEY.backspace, width: 2 }),
  row({ label: "Tab", keysym: KEY.tab, width: 2 }, ...["q","w","e","r","t","y","u","i","o","p","[","]","\\"].map((c) => ({ label: c, keysym: charKeysym(c) }))),
  row({ label: "Caps", keysym: KEY.caps, width: 2 }, ...["a","s","d","f","g","h","j","k","l",";","'"].map((c) => ({ label: c, keysym: charKeysym(c) })), { label: "Enter", keysym: KEY.enter, width: 2 }),
  row({ label: "Shift", keysym: KEY.shift, modifier: "shift", width: 2 }, ...["z","x","c","v","b","n","m",",",".","/"].map((c) => ({ label: c, keysym: charKeysym(c) })), { label: "Shift", keysym: KEY.shift, modifier: "shift", width: 2 }),
  row({ label: "Ctrl", keysym: KEY.ctrl, modifier: "ctrl", width: 2 }, { label: "Alt", keysym: KEY.alt, modifier: "alt", width: 2 }, { label: "Space", keysym: KEY.space, width: 6 }, { label: "Alt", keysym: KEY.alt, modifier: "alt", width: 2 }, { label: "Menu", keysym: KEY.menu }, { label: "Ctrl", keysym: KEY.ctrl, modifier: "ctrl", width: 2 }),
  row({ label: "Ins", keysym: KEY.ins }, { label: "Home", keysym: KEY.home }, { label: "PgUp", keysym: KEY.pgup }, { label: "Del", keysym: KEY.del }, { label: "End", keysym: KEY.end }, { label: "PgDn", keysym: KEY.pgdn }, { label: "←", keysym: KEY.left }, { label: "↑", keysym: KEY.up }, { label: "↓", keysym: KEY.down }, { label: "→", keysym: KEY.right }),
];
