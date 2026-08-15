# Session Control Panel + On-Screen Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded, collapsible Session Control Panel + a full on-screen keyboard, shared by GATEWAY and ISOLATED sessions, via a per-stack adapter driven by one X11-keysym map.

**Architecture:** Pure logic (keysym map + sticky-modifier reducer) in `src/lib/session/`; two presentation components (`OnScreenKeyboard`, `SessionControlPanel`) in the session dir; each session page builds a `SessionAdapter` and renders the shared components, removing its scattered controls.

**Tech Stack:** Next.js/TypeScript, guacamole-common-js (gateway), KasmVNC/noVNC iframe (isolated), vitest.

## Global Constraints

- **Language:** English only — comments, identifiers, UI strings, commits (public repo).
- **No Claude signature** in commits.
- **X11 keysyms:** printable ASCII (0x20–0x7E) keysym = the code point; special keys use 0xFFxx keysyms (listed in Task 1). One map drives both stacks (`sendKeyEvent` and `RFB.sendKey` both take X11 keysyms).
- **Sticky modifiers:** Ctrl/Alt/Shift accumulate (arm multiple); the next non-modifier key fires the chord (armed-mods down → key down/up → armed-mods up) and clears all armed modifiers. Covers Ctrl+Alt+Del.
- **Compliance notices stay visible:** the RECORDED badge and monitored/take-control notices are NOT moved into the panel — leave them as always-on overlays.
- **Web-app (TRANSPARENT) sessions:** unchanged; the panel/keyboard are only for gateway + isolated.
- **Deploy + release notes are SEPARATE gates.** Manager-only change (no data-plane/broker/connector update). Stop when committed + build/tests green.
- **Design:** Captivo tokens (navy + verified-teal) from `globals.css`; match the existing control styling (dark translucent) already in the two client files.

---

## File Structure

- Create: `src/lib/session/keysyms.ts` — keysym constants, `charKeysym()`, `KEYBOARD_ROWS` layout data.
- Create: `src/lib/session/keysyms.test.ts`
- Create: `src/lib/session/modifiers.ts` — `applyKey()` sticky-modifier reducer.
- Create: `src/lib/session/modifiers.test.ts`
- Create: `src/app/gateway/[siteId]/session/on-screen-keyboard.tsx` — keyboard + right edge handle.
- Create: `src/app/gateway/[siteId]/session/session-control-panel.tsx` — panel + left edge handle.
- Modify: `src/app/gateway/[siteId]/session/session-client.tsx` — gateway adapter + wire, remove superseded controls.
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx` — isolated adapter + wire, replace the mobile key bar.
- Possibly: `src/app/globals.css` — panel/handle/keyboard classes (or inline styles matching existing pattern).

---

### Task 1: Keysym map + sticky-modifier reducer (pure)

**Files:**
- Create: `src/lib/session/keysyms.ts`, `src/lib/session/keysyms.test.ts`
- Create: `src/lib/session/modifiers.ts`, `src/lib/session/modifiers.test.ts`

**Interfaces:**
- Produces:
  - `charKeysym(ch: string): number` — X11 keysym for a printable ASCII char (its code point).
  - `KEY` — record of special keysyms: `esc, tab, backspace, enter, caps, shift, ctrl, alt, super, menu, space, del, ins, home, end, pgup, pgdn, left, up, down, right, f1..f12`.
  - `KEYBOARD_ROWS: KeyDef[][]` — the on-screen layout; each `KeyDef = { label: string; keysym: number; modifier?: "ctrl"|"alt"|"shift"; width?: number }`.
  - `type ModState = { ctrl: boolean; alt: boolean; shift: boolean }`; `EMPTY_MODS`.
  - `applyKey(state: ModState, key: KeyDef): { events: { keysym: number; pressed: boolean }[]; next: ModState }`.

- [ ] **Step 1: Write the failing keysym test**

Create `src/lib/session/keysyms.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it (fail)**

Run: `cd /opt/captivo-access && npx vitest run src/lib/session/keysyms.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `keysyms.ts`**

Create `src/lib/session/keysyms.ts`:
```ts
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
```

- [ ] **Step 4: Run keysym test (pass)**

Run: `cd /opt/captivo-access && npx vitest run src/lib/session/keysyms.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing modifier-reducer test**

Create `src/lib/session/modifiers.test.ts`:
```ts
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
```

- [ ] **Step 6: Run it (fail)**

Run: `cd /opt/captivo-access && npx vitest run src/lib/session/modifiers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `modifiers.ts`**

Create `src/lib/session/modifiers.ts`:
```ts
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
```

- [ ] **Step 8: Run modifier test (pass) + commit**

Run: `cd /opt/captivo-access && npx vitest run src/lib/session/`
Expected: all PASS.
```bash
cd /opt/captivo-access
git add src/lib/session
git commit -m "feat(session): X11 keysym map + sticky-modifier reducer for the on-screen keyboard"
```

---

### Task 2: OnScreenKeyboard component

**Files:**
- Create: `src/app/gateway/[siteId]/session/on-screen-keyboard.tsx`

**Interfaces:**
- Consumes: `KEYBOARD_ROWS`, `applyKey`, `EMPTY_MODS`, `ModState` (Task 1).
- Produces: `<OnScreenKeyboard sendKey={(keysym, pressed) => void} />` — renders a right edge handle (keyboard icon) that toggles a bottom slide-up full keyboard. Each key press runs `applyKey` and calls `sendKey` for each emitted event; armed modifiers render highlighted.

- [ ] **Step 1: Implement the component**

Create `src/app/gateway/[siteId]/session/on-screen-keyboard.tsx`:
```tsx
"use client";
import { useState } from "react";
import { KEYBOARD_ROWS, type KeyDef } from "@/lib/session/keysyms";
import { applyKey, EMPTY_MODS, type ModState } from "@/lib/session/modifiers";

export function OnScreenKeyboard({ sendKey }: { sendKey: (keysym: number, pressed: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [mods, setMods] = useState<ModState>(EMPTY_MODS);

  const press = (k: KeyDef) => {
    const { events, next } = applyKey(mods, k);
    for (const e of events) sendKey(e.keysym, e.pressed);
    setMods(next);
  };
  const armed = (k: KeyDef) => k.modifier && mods[k.modifier];

  return (
    <>
      <button type="button" title="Keyboard" onClick={() => setOpen((v) => !v)} className="osk-handle" aria-label="On-screen keyboard">⌨</button>
      {open && (
        <div className="osk" role="group" aria-label="On-screen keyboard">
          <button type="button" className="osk-close" onClick={() => setOpen(false)} aria-label="Close keyboard">✕</button>
          {KEYBOARD_ROWS.map((r, i) => (
            <div key={i} className="osk-row">
              {r.map((k, j) => (
                <button key={j} type="button" className={"osk-key" + (armed(k) ? " armed" : "")} style={{ flexGrow: k.width ?? 1 }} onClick={() => press(k)}>
                  {k.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add CSS**

Append to `src/app/globals.css` (match the existing dark translucent control look; navy + verified-teal accent for the handle/armed state — reuse existing tokens if present):
```css
.osk-handle { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 30; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-right: 0; border-radius: 8px 0 0 8px; padding: 10px 8px; font-size: 18px; cursor: pointer; }
.osk { position: fixed; left: 0; right: 0; bottom: 0; z-index: 31; background: rgba(15,23,42,0.96); padding: 10px 8px 14px; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.osk-row { display: flex; gap: 4px; width: 100%; max-width: 980px; }
.osk-key { flex: 1 1 0; min-width: 0; background: #334155; color: #fff; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 10px 6px; font: 13px/1 sans-serif; cursor: pointer; }
.osk-key.armed { background: #14b8a6; color: #06282a; }
.osk-close { align-self: flex-end; background: transparent; color: #cbd5e1; border: 0; font-size: 16px; cursor: pointer; }
```

- [ ] **Step 3: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 4: Commit**

```bash
cd /opt/captivo-access
git add "src/app/gateway/[siteId]/session/on-screen-keyboard.tsx" src/app/globals.css
git commit -m "feat(session): OnScreenKeyboard component (full keyboard + edge handle)"
```

---

### Task 3: SessionControlPanel component

**Files:**
- Create: `src/app/gateway/[siteId]/session/session-control-panel.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `<SessionControlPanel actions={PanelAction[]} />` where
  `type PanelAction = { key: string; label: string; sublabel?: string; icon?: string; onClick?: () => void; status?: string }`.
  Renders a left edge handle that slides out a branded panel listing the actions; a status-only action renders as a non-clickable row.

- [ ] **Step 1: Implement the component**

Create `src/app/gateway/[siteId]/session/session-control-panel.tsx`:
```tsx
"use client";
import { useState } from "react";

export type PanelAction = { key: string; label: string; sublabel?: string; onClick?: () => void; status?: string };

export function SessionControlPanel({ actions }: { actions: PanelAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="scp-handle" onClick={() => setOpen((v) => !v)} aria-label="Session controls" title="Session controls">⋮⋮</button>
      {open && (
        <div className="scp" role="group" aria-label="Session controls">
          <div className="scp-head"><span>Control Panel</span><button type="button" className="scp-close" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
          {actions.map((a) => (
            <button key={a.key} type="button" className="scp-item" disabled={!a.onClick} onClick={a.onClick}>
              <div className="scp-item-label">{a.label}</div>
              {(a.sublabel || a.status) && <div className="scp-item-sub">{a.status ?? a.sublabel}</div>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add CSS**

Append to `src/app/globals.css`:
```css
.scp-handle { position: fixed; left: 0; top: 16px; z-index: 30; background: rgba(15,23,42,0.85); color: #14b8a6; border: 1px solid rgba(255,255,255,0.2); border-left: 0; border-radius: 0 8px 8px 0; padding: 8px 6px; cursor: pointer; letter-spacing: 2px; }
.scp { position: fixed; left: 0; top: 0; bottom: 0; width: 300px; max-width: 86vw; z-index: 31; background: rgba(15,23,42,0.97); color: #e2e8f0; display: flex; flex-direction: column; gap: 4px; padding: 12px; overflow-y: auto; }
.scp-head { display: flex; justify-content: space-between; align-items: center; font: 600 15px/1 sans-serif; margin-bottom: 8px; }
.scp-close { background: transparent; border: 0; color: #94a3b8; font-size: 16px; cursor: pointer; }
.scp-item { text-align: left; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 12px; color: inherit; cursor: pointer; }
.scp-item:disabled { cursor: default; opacity: 0.75; }
.scp-item-label { font: 600 14px/1.2 sans-serif; }
.scp-item-sub { font: 12px/1.2 sans-serif; color: #94a3b8; margin-top: 2px; }
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.
```bash
cd /opt/captivo-access
git add "src/app/gateway/[siteId]/session/session-control-panel.tsx" src/app/globals.css
git commit -m "feat(session): SessionControlPanel component (edge-docked slide-out panel)"
```

---

### Task 4: Gateway adapter + wire

**Files:**
- Modify: `src/app/gateway/[siteId]/session/session-client.tsx`

**Interfaces:**
- Consumes: `OnScreenKeyboard`, `SessionControlPanel`, `PanelAction`.
- Produces: the gateway session renders the shared panel + keyboard; keys go through `client.sendKeyEvent`.

- [ ] **Step 1: Capture a client ref**

In `src/app/gateway/[siteId]/session/session-client.tsx`, add a ref near the others (~line 18):
```tsx
  const clientRef = useRef<any>(null);
```
In the connect effect, after `client = new Guacamole.Client(tunnel);` (~line 135), add:
```tsx
      clientRef.current = client;
```

- [ ] **Step 2: Render the shared components**

Add the imports at the top:
```tsx
import { OnScreenKeyboard } from "./on-screen-keyboard";
import { SessionControlPanel, type PanelAction } from "./session-control-panel";
```
In the returned JSX (inside the top-level container, alongside the existing overlays), add:
```tsx
      <SessionControlPanel
        actions={[
          { key: "fs", label: "Full screen", sublabel: "Fill the screen", onClick: () => toggleFs() },
          { key: "clip", label: "Clipboard", status: `${caps.allowCopyOut ? "copy" : "no-copy"} · ${caps.allowPasteIn ? "paste" : "no-paste"}`, onClick: () => setClipboardOpen(true) },
          { key: "leave", label: "Leave session", sublabel: "Disconnect", onClick: () => clientRef.current?.disconnect() },
        ]}
      />
      <OnScreenKeyboard sendKey={(keysym, pressed) => clientRef.current?.sendKeyEvent(pressed ? 1 : 0, keysym)} />
```
(Use the existing fullscreen toggle — the function behind `fsRef`/line ~92; if it is named differently, call that. If `toggleFs` does not exist as a callable, extract the existing fullscreen logic into a `toggleFs()` function first.)

- [ ] **Step 3: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 4: Commit**

```bash
cd /opt/captivo-access
git add "src/app/gateway/[siteId]/session/session-client.tsx"
git commit -m "feat(session): wire control panel + keyboard into gateway sessions"
```

---

### Task 5: Isolated adapter + wire (replace the mobile key bar)

**Files:**
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx`

**Interfaces:**
- Consumes: the shared components; the existing `kbInput`/`sendKey` mechanism.
- Produces: isolated sessions render the same panel + keyboard; the previous 7-key mobile bar is removed (superseded by the full keyboard).

- [ ] **Step 1: Add a keysym-based send + render the shared components**

In `src/app/gateway/[siteId]/session/isolated-client.tsx`:
1. Add imports:
```tsx
import { OnScreenKeyboard } from "./on-screen-keyboard";
import { SessionControlPanel } from "./session-control-panel";
```
2. Add a keysym sender that reuses the existing RFB/synthetic path. Near the existing `sendKey` helper, add:
```tsx
  // Send a raw X11 keysym to the isolated session: prefer the RFB API if exposed,
  // else a synthetic KeyboardEvent on the hidden keyboard input (best-effort).
  const sendKeysym = (keysym: number, pressed: boolean) => {
    const el = kbInput();
    if (!el) return;
    el.focus();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rfb: any = (frameRef.current?.contentWindow as any)?.rfb;
    if (rfb?.sendKey) { rfb.sendKey(keysym, null, pressed); return; }
    if (!pressed) return; // synthetic path fires on the down edge only
    const ch = keysym >= 0x20 && keysym <= 0x7e ? String.fromCharCode(keysym) : "";
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ch || " ", bubbles: true }));
  };
```
3. Replace the existing mobile-toolbar block (the `{isTouch && ready && dims && ( ... Esc/Tab/arrows/Ctrl ... )}` JSX added earlier) with the shared components:
```tsx
      {ready && dims && (
        <>
          <SessionControlPanel
            actions={[
              { key: "fs", label: "Full screen", sublabel: fs ? "Exit" : "Fill the screen", onClick: toggleFs },
              ...(canUpload ? [{ key: "up", label: "Upload file", sublabel: "Send a file into the browser", onClick: () => fileRef.current?.click() }] : []),
              { key: "leave", label: "Leave session", sublabel: "Return to My access", onClick: () => { window.location.href = "/access"; } },
            ]}
          />
          <OnScreenKeyboard sendKey={sendKeysym} />
        </>
      )}
```
Keep the existing hidden `<input ref={fileRef} ...>`, the downloads tray, the RECORDED/monitored badges, and the standalone Fullscreen button may be removed (now in the panel) or kept — remove it to declutter. Remove the now-unused `ctrlHeld`/`setCtrlHeld` state and the old `sendKey` special-key helper if nothing else uses them (the full keyboard supersedes them).

- [ ] **Step 2: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`. (Fix any unused-variable errors from removed toolbar code.)

- [ ] **Step 3: Commit**

```bash
cd /opt/captivo-access
git add "src/app/gateway/[siteId]/session/isolated-client.tsx"
git commit -m "feat(session): wire control panel + keyboard into isolated sessions (replaces mobile key bar)"
```

---

## Final verification (after all tasks)

- [ ] `cd /opt/captivo-access && npx vitest run src/lib/session/` — green.
- [ ] `cd /opt/captivo-access && pnpm build` — Compiled successfully.
- [ ] **Manual (post-deploy):** GATEWAY (RDP) — open the left panel + right keyboard; send `Ctrl+Alt+Del` (arm Ctrl, arm Alt, tap Del), F-keys, arrows; toggle fullscreen; open clipboard; leave. ISOLATED — panel + keyboard toggle work (keyboard letters at minimum via the soft-keyboard path; note if special keys via the full keyboard don't register on the embed). Confirm RECORDED / monitored badges stay visible with the panel open, and web-app sessions are unchanged.

## Release (SEPARATE GATES — do not auto-run)

Manager-only change. After the user approves deploy: bump version, tag (CI rebuilds images), update the central manager (no connector/data-plane/broker change needed). On tag, add an English user-focused `gh release edit` note.
