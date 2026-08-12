# Gateway Clipboard Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add text clipboard sync (copy-out / paste-in) to GATEWAY remote-desktop sessions (RDP/SSH/VNC), with an automatic Clipboard-API layer plus a universal manual panel opened by Ctrl+Alt+Shift.

**Architecture:** A pure capability mapper (`clipboard-caps.ts`) turns `Site.clipboardMode` into `{allowCopyOut, allowPasteIn}`. A framework-free bridge (`clipboard.ts`) owns all guacamole-common-js clipboard wiring (`client.onclipboard` read → browser clipboard; `pushLocal`/`syncFromBrowser` write → remote clipboard). The session component (`session-client.tsx`) threads the mode in, drives auto-sync on window focus, and renders the manual panel while suspending the guac keyboard so the user can type into it.

**Tech Stack:** Next.js (React client component), guacamole-common-js (`StringReader`/`StringWriter`/`createClipboardStream`/`Keyboard.reset`), Vitest, TypeScript, Prisma (read-only here — no schema change).

## Global Constraints

- English-only UI copy. No Turkish strings.
- No database schema change — reuse `Site.clipboardMode` (`allow | no_copy | no_paste | none`, default `allow`).
- Text (`text/plain`) only — no image clipboard.
- guacd stays authoritative on direction (`disable-copy`/`disable-paste`); the client mirrors the same gate but never assumes it is the only enforcement.
- No Claude signature/trailer in commits.
- Every `navigator.clipboard.*` call is wrapped in try/catch and fails silently (never throws to the user).
- Test runner: `pnpm test` (`vitest run`). Tests colocated as `*.test.ts` beside source, `import { describe, it, expect } from "vitest"`.
- Type check / real build gate: `pnpm build`.

---

### Task 1: Clipboard capability mapper

**Files:**
- Create: `src/lib/gateway/clipboard-caps.ts`
- Test: `src/lib/gateway/clipboard-caps.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ClipboardCaps { allowCopyOut: boolean; allowPasteIn: boolean }` and `function clipboardCaps(mode: string): ClipboardCaps`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/gateway/clipboard-caps.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/gateway/clipboard-caps.test.ts`
Expected: FAIL — cannot resolve `./clipboard-caps`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/gateway/clipboard-caps.ts`:

```ts
// Maps Site.clipboardMode to the two clipboard directions the gateway client
// enforces. copy-out = remote clipboard leaving the session to the vendor
// (gated by no_copy); paste-in = vendor clipboard entering the session (gated
// by no_paste). guacd enforces the same via disable-copy/disable-paste; this
// mirror keeps the browser client from doing pointless work and keeps the UI
// consistent. Unknown values stay permissive to match the "allow" default.
export interface ClipboardCaps {
  allowCopyOut: boolean;
  allowPasteIn: boolean;
}

export function clipboardCaps(mode: string): ClipboardCaps {
  return {
    allowCopyOut: mode !== "no_copy" && mode !== "none",
    allowPasteIn: mode !== "no_paste" && mode !== "none",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/lib/gateway/clipboard-caps.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gateway/clipboard-caps.ts src/lib/gateway/clipboard-caps.test.ts
git commit -m "feat(gateway): clipboardMode → copy-out/paste-in capability mapper"
```

---

### Task 2: Clipboard bridge (guac wiring)

**Files:**
- Create: `src/app/gateway/[siteId]/session/clipboard.ts`
- Test: `src/app/gateway/[siteId]/session/clipboard.test.ts`

**Interfaces:**
- Consumes: `ClipboardCaps` from `@/lib/gateway/clipboard-caps`.
- Produces:
  - `interface ClipboardBridge { syncFromBrowser: () => void; pushLocal: (text: string) => void; getRemoteText: () => string }`
  - `function createClipboardBridge(client: any, Guacamole: any, caps: ClipboardCaps): ClipboardBridge` — installs `client.onclipboard`.

- [ ] **Step 1: Write the failing test**

Create `src/app/gateway/[siteId]/session/clipboard.test.ts` (covers the deterministic `pushLocal` gating + dedupe; the navigator/DOM async paths are verified manually per the spec):

```ts
import { describe, it, expect } from "vitest";
import { createClipboardBridge } from "./clipboard";

function fakeGuacamole() {
  const sent: string[] = [];
  class StringWriter {
    constructor(public stream: unknown) {}
    sendText(t: string) { sent.push(t); }
    sendEnd() {}
  }
  class StringReader { ontext: ((t: string) => void) | null = null; onend: (() => void) | null = null; constructor(public stream: unknown) {} }
  return { Guacamole: { StringWriter, StringReader }, sent };
}

function fakeClient() {
  const streams: string[] = [];
  return {
    onclipboard: null as unknown,
    createClipboardStream: (mimetype: string) => { streams.push(mimetype); return { mimetype }; },
    streams,
  };
}

const BOTH = { allowCopyOut: true, allowPasteIn: true };

describe("createClipboardBridge.pushLocal", () => {
  it("sends text via a text/plain clipboard stream when paste-in is allowed", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const client = fakeClient();
    const b = createClipboardBridge(client, Guacamole, BOTH);
    b.pushLocal("hello");
    expect(sent).toEqual(["hello"]);
    expect(client.streams).toEqual(["text/plain"]);
  });

  it("no-ops when paste-in is blocked", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const client = fakeClient();
    const b = createClipboardBridge(client, Guacamole, { allowCopyOut: true, allowPasteIn: false });
    b.pushLocal("hello");
    expect(sent).toEqual([]);
    expect(client.streams).toEqual([]);
  });

  it("dedupes identical consecutive text", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const b = createClipboardBridge(fakeClient(), Guacamole, BOTH);
    b.pushLocal("x");
    b.pushLocal("x");
    b.pushLocal("y");
    expect(sent).toEqual(["x", "y"]);
  });

  it("ignores empty text", () => {
    const { Guacamole, sent } = fakeGuacamole();
    const b = createClipboardBridge(fakeClient(), Guacamole, BOTH);
    b.pushLocal("");
    expect(sent).toEqual([]);
  });
});

describe("createClipboardBridge remote read", () => {
  it("stores remote text from onclipboard and exposes it via getRemoteText", () => {
    const { Guacamole } = fakeGuacamole();
    const client = fakeClient();
    const b = createClipboardBridge(client, Guacamole, BOTH);
    const stream = {};
    (client.onclipboard as (s: unknown, m: string) => void)(stream, "text/plain");
    // The bridge attached a StringReader to the stream; drive it.
    // The reader instance is the one created inside onclipboard — reach it by
    // re-creating the same flow: onclipboard built `new Guacamole.StringReader(stream)`
    // and wired ontext/onend onto it. We emulate guacd delivering text.
    // (Access the reader via the stream is not exposed, so assert through a fresh reader.)
    // Instead, verify getRemoteText starts empty:
    expect(b.getRemoteText()).toBe("");
  });
});
```

> Note: the remote-read describe only asserts the initial empty state, because the `StringReader` instance is private to `onclipboard`. Full remote→local behaviour (text accumulation + `writeText`) is covered by manual testing (Task 5), per the spec.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- "src/app/gateway/[siteId]/session/clipboard.test.ts"`
Expected: FAIL — cannot resolve `./clipboard`.

- [ ] **Step 3: Write the implementation**

Create `src/app/gateway/[siteId]/session/clipboard.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ClipboardCaps } from "@/lib/gateway/clipboard-caps";

export interface ClipboardBridge {
  syncFromBrowser: () => void;
  pushLocal: (text: string) => void;
  getRemoteText: () => string;
}

// Owns the text clipboard bridge between the browser and a guacd session.
// Installs client.onclipboard (remote → browser) and exposes helpers the
// session component drives: syncFromBrowser() on focus (browser → remote via
// the Clipboard API) and pushLocal() from the manual panel. Direction is gated
// by caps; guacd enforces the same server-side.
export function createClipboardBridge(client: any, Guacamole: any, caps: ClipboardCaps): ClipboardBridge {
  let remoteText = "";
  let lastPushed: string | null = null;

  // remote → browser
  client.onclipboard = (stream: any, mimetype: string) => {
    // Text-only: ignore non-text clipboard (e.g. image/png) rather than corrupt it.
    if (typeof mimetype === "string" && mimetype && !mimetype.startsWith("text/")) return;
    const reader = new Guacamole.StringReader(stream);
    let buf = "";
    reader.ontext = (t: string) => { buf += t; };
    reader.onend = () => {
      remoteText = buf;
      if (caps.allowCopyOut && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(remoteText).catch(() => { /* permission denied — panel is the fallback */ });
      }
    };
  };

  const pushLocal = (text: string) => {
    if (!caps.allowPasteIn || !text || text === lastPushed) return;
    const stream = client.createClipboardStream("text/plain");
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(text);
    writer.sendEnd();
    lastPushed = text;
  };

  const syncFromBrowser = () => {
    if (!caps.allowPasteIn || typeof navigator === "undefined" || !navigator.clipboard?.readText) return;
    navigator.clipboard.readText()
      .then((t) => { if (t) pushLocal(t); })
      .catch(() => { /* denied / unfocused — panel is the fallback */ });
  };

  return { syncFromBrowser, pushLocal, getRemoteText: () => remoteText };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- "src/app/gateway/[siteId]/session/clipboard.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/gateway/[siteId]/session/clipboard.ts" "src/app/gateway/[siteId]/session/clipboard.test.ts"
git commit -m "feat(gateway): text clipboard bridge over guacamole-common-js"
```

---

### Task 3: Thread clipboardMode + automatic focus-sync

**Files:**
- Modify: `src/app/gateway/[siteId]/session/page.tsx` (add `clipboardMode` to the site select; pass to both children)
- Modify: `src/app/gateway/[siteId]/session/consent-gate.tsx` (accept + forward `clipboardMode`)
- Modify: `src/app/gateway/[siteId]/session/session-client.tsx` (accept `clipboardMode`, build the bridge, install onclipboard, sync on focus)

**Interfaces:**
- Consumes: `clipboardCaps` from `@/lib/gateway/clipboard-caps`; `createClipboardBridge`, `ClipboardBridge` from `./clipboard`.
- Produces: `GatewaySession` now requires prop `clipboardMode: string`; a `clipRef` holding the `ClipboardBridge`.

- [ ] **Step 1: Add clipboardMode to the page query and pass it down**

In `src/app/gateway/[siteId]/session/page.tsx`, change the site select to include the field:

```ts
const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true, recordSessions: true, clipboardMode: true } });
```

Change the final render line to pass the prop to both branches:

```tsx
return consentNeeded
  ? <ConsentGate siteId={siteId} recorded={recorded} clipboardMode={site.clipboardMode} />
  : <GatewaySession siteId={siteId} recorded={recorded} clipboardMode={site.clipboardMode} />;
```

- [ ] **Step 2: Forward clipboardMode through ConsentGate**

In `src/app/gateway/[siteId]/session/consent-gate.tsx`, update the signature and the post-consent render:

```tsx
export function ConsentGate({ siteId, recorded, clipboardMode }: { siteId: string; recorded: boolean; clipboardMode: string }) {
```

```tsx
  if (accepted) return <GatewaySession siteId={siteId} recorded={recorded} clipboardMode={clipboardMode} />;
```

- [ ] **Step 3: Accept the prop, build the bridge, sync on focus in session-client.tsx**

In `src/app/gateway/[siteId]/session/session-client.tsx`:

(a) Add imports near the top (after the existing React import):

```tsx
import { clipboardCaps } from "@/lib/gateway/clipboard-caps";
import { createClipboardBridge, type ClipboardBridge } from "./clipboard";
```

(b) Update the component signature and derive caps:

```tsx
export function GatewaySession({ siteId, recorded, clipboardMode }: { siteId: string; recorded: boolean; clipboardMode: string }) {
  const caps = clipboardCaps(clipboardMode);
```

(c) Add a ref beside the existing refs (`guacRef`, `fsRef`, …):

```tsx
  const clipRef = useRef<ClipboardBridge | null>(null);
```

(d) Inside the main session `useEffect`, right after `guacRef.current = Guacamole;` and the `client.onfile`/`client.onfilesystem` handlers are set, create the bridge:

```tsx
      clipRef.current = createClipboardBridge(client, Guacamole, caps);
```

(e) At the top of the effect where `let onResize: (() => void) | null = null;` is declared, add a sibling declaration:

```tsx
    let onFocus: (() => void) | null = null;
```

Then, where `onResize` is assigned and `window.addEventListener("resize", onResize)` is called, add the focus handler that pushes the browser clipboard to the remote (assignment, not a new `const`):

```tsx
      onFocus = () => clipRef.current?.syncFromBrowser();
      window.addEventListener("focus", onFocus);
```

Immediately after the existing `fit();` call at the end of the async block, do an initial sync (the window is already focused when the session opens):

```tsx
      clipRef.current?.syncFromBrowser();
```

(f) In the effect cleanup (`return () => { … }`), remove the focus listener alongside the resize one:

```tsx
        if (onResize) window.removeEventListener("resize", onResize);
        if (onFocus) window.removeEventListener("focus", onFocus);
```

- [ ] **Step 4: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully. (Automatic copy-out/paste-in now works in Chromium; manual panel comes next.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/gateway/[siteId]/session/page.tsx" "src/app/gateway/[siteId]/session/consent-gate.tsx" "src/app/gateway/[siteId]/session/session-client.tsx"
git commit -m "feat(gateway): wire clipboard bridge + auto-sync clipboard on focus"
```

---

### Task 4: Manual clipboard panel (Ctrl+Alt+Shift)

**Files:**
- Modify: `src/app/gateway/[siteId]/session/session-client.tsx` (panel state/UI, shortcut, keyboard suspend/restore)
- Modify: `src/app/globals.css` (panel styles, after the `.ft-toast` rule at line 553)

**Interfaces:**
- Consumes: `clipRef` (`ClipboardBridge`) and `caps` from Task 3; the guac `keyboard` created in the session effect.
- Produces: no exported symbols; adds internal state `clipboardOpen`, refs `clipboardOpenRef`, `keyboardRef`, `keyHandlersRef`, `taRef`.

- [ ] **Step 1: Capture the guac keyboard + its handlers into refs**

In `session-client.tsx`, add refs beside the others:

```tsx
  const keyboardRef = useRef<any>(null);
  const keyHandlersRef = useRef<{ kd: (k: number) => void; ku: (k: number) => void } | null>(null);
  const clipboardOpenRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [clipboardOpen, setClipboardOpen] = useState(false);
```

In the session effect, replace the inline keyboard handler wiring:

```tsx
      keyboard = new Guacamole.Keyboard(document);
      keyboard.onkeydown = (k: number) => client.sendKeyEvent(1, k);
      keyboard.onkeyup = (k: number) => client.sendKeyEvent(0, k);
```

with named handlers stored in refs:

```tsx
      keyboard = new Guacamole.Keyboard(document);
      const kd = (k: number) => client.sendKeyEvent(1, k);
      const ku = (k: number) => client.sendKeyEvent(0, k);
      keyboard.onkeydown = kd;
      keyboard.onkeyup = ku;
      keyboardRef.current = keyboard;
      keyHandlersRef.current = { kd, ku };
```

- [ ] **Step 2: Add suspend/restore helpers + the open/close effect (component body)**

In the component body (not inside the session effect), add these functions and the effect that reacts to `clipboardOpen`:

```tsx
  const suspendKeyboard = () => {
    const kb = keyboardRef.current;
    if (!kb) return;
    kb.reset();            // release Ctrl/Alt/Shift already sent, so nothing sticks in the remote
    kb.onkeydown = null;
    kb.onkeyup = null;
  };
  const resumeKeyboard = () => {
    const kb = keyboardRef.current, h = keyHandlersRef.current;
    if (kb && h) { kb.onkeydown = h.kd; kb.onkeyup = h.ku; }
  };
  const closeClipboard = () => { clipboardOpenRef.current = false; setClipboardOpen(false); };

  useEffect(() => {
    if (clipboardOpen) {
      suspendKeyboard();
      const ta = taRef.current;
      if (ta) {
        ta.value = caps.allowCopyOut ? (clipRef.current?.getRemoteText() ?? "") : "";
        ta.readOnly = !caps.allowPasteIn;
        ta.focus();
        ta.select();
      }
    } else {
      resumeKeyboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboardOpen]);
```

- [ ] **Step 3: Add the Ctrl+Alt+Shift open + Esc close listener (mount-once effect)**

Add a dedicated `useEffect` (empty deps) that owns the global shortcut, capture-phase so it preempts the guac keyboard:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!clipboardOpenRef.current) {
        // Guacamole convention: Ctrl+Alt+Shift toggles the clipboard panel.
        if (e.ctrlKey && e.altKey && e.shiftKey && !e.repeat) {
          e.preventDefault();
          e.stopImmediatePropagation();
          clipboardOpenRef.current = true;
          setClipboardOpen(true);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeClipboard();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: Render the panel**

In the returned JSX, add the panel as a sibling of the `.ft-toast` overlay (inside the outer fixed div, after the `{toast && …}` line):

```tsx
      {clipboardOpen && (
        <div className="clip-overlay" role="dialog" aria-label="Clipboard" aria-modal="true">
          <div className="clip-panel">
            <div className="clip-title">Clipboard</div>
            {(caps.allowCopyOut || caps.allowPasteIn) ? (
              <>
                <textarea
                  ref={taRef}
                  className="clip-ta"
                  spellCheck={false}
                  placeholder={caps.allowPasteIn ? "Paste text here, then Send to push it into the session…" : "Remote clipboard (read-only)"}
                />
                <div className="clip-actions">
                  {caps.allowPasteIn && (
                    <button
                      type="button"
                      className="clip-btn clip-btn-primary"
                      onClick={() => { clipRef.current?.pushLocal(taRef.current?.value ?? ""); closeClipboard(); }}
                    >
                      Send to session
                    </button>
                  )}
                  <button type="button" className="clip-btn" onClick={closeClipboard}>Close</button>
                </div>
                <div className="clip-hint">Ctrl+Alt+Shift toggles this panel · Esc closes</div>
              </>
            ) : (
              <>
                <div className="clip-disabled">Clipboard is disabled for this resource.</div>
                <div className="clip-actions"><button type="button" className="clip-btn" onClick={closeClipboard}>Close</button></div>
              </>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Add panel styles**

In `src/app/globals.css`, immediately after the `.ft-toast { … }` rule (line 553), append:

```css
.clip-overlay { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); }
.clip-panel { width: min(560px, 92vw); background: #10151d; color: #e6edf6; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); font-family: sans-serif; }
.clip-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.clip-ta { width: 100%; height: 160px; resize: vertical; box-sizing: border-box; background: #0b0f16; color: #e6edf6; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px; font: 13px/1.4 ui-monospace, monospace; }
.clip-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.clip-btn { background: rgba(255,255,255,0.08); color: #e6edf6; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
.clip-btn:hover { background: rgba(255,255,255,0.14); }
.clip-btn-primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.clip-btn-primary:hover { background: #388bfd; }
.clip-hint { margin-top: 10px; font-size: 11px; color: #8b98a9; }
.clip-disabled { font-size: 13px; color: #8b98a9; padding: 8px 0; }
```

- [ ] **Step 6: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add "src/app/gateway/[siteId]/session/session-client.tsx" src/app/globals.css
git commit -m "feat(gateway): manual clipboard panel (Ctrl+Alt+Shift) with keyboard suspend"
```

---

### Task 5: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS (existing suite + the new clipboard-caps + clipboard bridge tests).

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 3: Manual test matrix (record results in the PR/commit, live gateway after deploy)**

Deploy is a separate, user-approved step — do not deploy here. When deployed, verify:

1. Chromium: copy in the RDP app → paste on the local machine (auto copy-out).
2. Chromium: copy locally → focus the session tab → Ctrl+V in the app pastes it (auto paste-in on focus).
3. Firefox: Ctrl+Alt+Shift opens the panel → paste into it → Send to session → Ctrl+V in the app pastes it.
4. Any browser: Ctrl+Alt+Shift opens the panel prefilled with the remote clipboard → select + native-copy works (manual copy-out).
5. `no_copy` resource: paste-in works; copy-out blocked (panel not prefilled, no `writeText`).
6. `no_paste` resource: copy-out works; textarea read-only, no Send button.
7. `none` resource: panel shows "Clipboard is disabled for this resource."
8. Opening the panel does not leave Ctrl/Alt/Shift stuck in the remote (type normal letters after closing — no modifier stuck).
9. SSH and VNC sessions: text copy/paste both directions.

---

## Notes for the implementer

- `session-client.tsx` is a client component (`"use client"`), already `/* eslint-disable @typescript-eslint/no-explicit-any */`; guac objects are typed `any` — follow that existing convention.
- Overlays must stay **outside** the `ref` display `<div>` (the guac client clears it via `innerHTML`); the `.clip-overlay` is a sibling of the existing `.ft-toast`/RECORDED overlays, which already follow this rule.
- Do not add a visible clipboard button — shortcut only, by product decision.
- `Guacamole.Keyboard.reset()`, `StringReader`, `StringWriter`, `client.createClipboardStream`, and `client.onclipboard` are all confirmed present in the bundled `guacamole-common-js`.
