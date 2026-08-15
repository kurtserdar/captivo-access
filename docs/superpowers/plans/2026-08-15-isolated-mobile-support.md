# Isolated Browser Mobile (Touch) Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ISOLATED sessions usable on phones — size the remote to the phone viewport (so the internal web app renders its mobile layout, native touch works ~1:1) and add a touch-only input toolbar (soft-keyboard toggle + special keys).

**Architecture:** Relax the min-width/height clamps in all three sizing layers (client, data-plane, broker) so a phone-sized desktop is allowed; the client sends viewport dims on touch devices; a touch-only toolbar in the outer session page drives KasmVNC's hidden keyboard input and sends special keys. Everything mobile is gated on a touch check, so desktop is unchanged.

**Tech Stack:** Next.js/TypeScript (manager UI), Go (data-plane), Python (kasm broker), vitest, `go test`, plain-assert broker test.

## Global Constraints

- **Language:** English only — comments, identifiers, UI strings, commit messages (public repo).
- **No Claude signature** in commits.
- **Clamp floors (verbatim):** new minimums are **width 360**, **height 480** in all three layers. Maximums and defaults unchanged (width max 2560, height max 1600, default 1280×800). Client mobile bounds: width `[360, 820]`, height `[480, 1180]`.
- **Touch detection (verbatim):** `window.matchMedia("(pointer: coarse)").matches`.
- **Keep unchanged:** `resize=scale` + fixed-desktop model (a server-side resize broke recording; do not switch to resize=remote); all desktop (fine-pointer) behavior; recording/clipboard/watermark/file-transfer/live-view paths.
- **Deploy + release notes are SEPARATE gates** — do NOT run docker builds, tags, connector updates, or `gh release`. Stop when committed + builds/tests green.
- The change spans manager + data-plane (central stack) **and** broker (`kasm-browser`, connector-side) — the broker floor only takes effect after the connector/gateway host updates.

---

## File Structure

- Modify: `dataplane/kasmtunnel.go` — clamp floors at the `clampKasmDim` call sites (lines ~224-225).
- Create: `dataplane/kasmtunnel_test.go` — lock `clampKasmDim` at the new floor.
- Modify: `kasm-browser/control.py` — clamp floors at the `_clamp_dim` call sites (lines ~346-347).
- Modify: `kasm-browser/control_test.py` — `_clamp_dim` floor cases.
- Create: `src/lib/isolated/dims.ts` — pure `isolatedDims(...)`.
- Create: `src/lib/isolated/dims.test.ts` — its tests.
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx` — touch detection, use `isolatedDims`, mobile input toolbar.

---

### Task 1: Relax the clamp floors (data-plane + broker)

**Files:**
- Modify: `dataplane/kasmtunnel.go:224-225`
- Create: `dataplane/kasmtunnel_test.go`
- Modify: `kasm-browser/control.py:346-347`
- Test: `kasm-browser/control_test.py`

**Interfaces:**
- Produces: a phone-sized desktop (down to 360×480) is accepted end-to-end; unset dims still default to 1280×800; desktop clients (≥1024) unaffected.

- [ ] **Step 1: Write the failing data-plane test**

Create `dataplane/kasmtunnel_test.go`:
```go
package main

import "testing"

func TestClampKasmDimFloor(t *testing.T) {
	// Below the new mobile floor clamps up to it; a phone width passes through.
	if got := clampKasmDim(100, 360, 2560, 1280); got != 360 {
		t.Errorf("clampKasmDim(100,360,...) = %d, want 360", got)
	}
	if got := clampKasmDim(400, 360, 2560, 1280); got != 400 {
		t.Errorf("clampKasmDim(400,360,...) = %d, want 400", got)
	}
	if got := clampKasmDim(0, 360, 2560, 1280); got != 1280 {
		t.Errorf("clampKasmDim(0,...) = %d, want default 1280", got)
	}
	if got := clampKasmDim(480, 480, 1600, 800); got != 480 {
		t.Errorf("clampKasmDim(480,480,...) = %d, want 480", got)
	}
}
```

- [ ] **Step 2: Run it (passes already — clampKasmDim is generic)**

Run: `cd /opt/captivo-access/dataplane && go test ./... -run TestClampKasmDimFloor`
Expected: PASS. (The function is generic; this test locks the floor behavior the call sites rely on. It is a guard, not red-first.)

- [ ] **Step 3: Lower the data-plane call-site floors**

In `dataplane/kasmtunnel.go` (~lines 224-225), change:
```go
			cw := clampKasmDim(kasmW, 1024, 2560, 1280)
			ch := clampKasmDim(kasmH, 640, 1600, 800)
```
to:
```go
			cw := clampKasmDim(kasmW, 360, 2560, 1280)
			ch := clampKasmDim(kasmH, 480, 1600, 800)
```

- [ ] **Step 4: Write the failing broker test**

In `kasm-browser/control_test.py`, add:
```python
def test_clamp_dim_floor():
    assert control._clamp_dim(100, 360, 2560, 1280) == 360
    assert control._clamp_dim(400, 360, 2560, 1280) == 400
    assert control._clamp_dim(None, 360, 2560, 1280) == 1280
    assert control._clamp_dim(480, 480, 1600, 800) == 480
```
And add `test_clamp_dim_floor()` to the `if __name__ == "__main__":` runner block.

- [ ] **Step 5: Lower the broker call-site floors**

In `kasm-browser/control.py` (~lines 346-347), change:
```python
            w = _clamp_dim(data.get("w"), 1024, 2560, 1280)
            h = _clamp_dim(data.get("h"), 640, 1600, 800)
```
to:
```python
            w = _clamp_dim(data.get("w"), 360, 2560, 1280)
            h = _clamp_dim(data.get("h"), 480, 1600, 800)
```

- [ ] **Step 6: Build + run both test suites**

Run:
```bash
cd /opt/captivo-access/dataplane && go build ./... && go test ./... -run TestClampKasmDimFloor
cd /opt/captivo-access/kasm-browser && python3 control_test.py && python3 -c "import py_compile; py_compile.compile('control.py', doraise=True)" && echo COMPILE_OK
```
Expected: Go test PASS; broker prints `ok`; `COMPILE_OK`.

- [ ] **Step 7: Commit**

```bash
cd /opt/captivo-access
git add dataplane/kasmtunnel.go dataplane/kasmtunnel_test.go kasm-browser/control.py kasm-browser/control_test.py
git commit -m "feat(isolated): allow phone-sized desktops (lower dimension clamp floors)"
```

---

### Task 2: Client mobile sizing

**Files:**
- Create: `src/lib/isolated/dims.ts`
- Test: `src/lib/isolated/dims.test.ts`
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx`

**Interfaces:**
- Consumes: Task 1 (server accepts sub-1024 dims).
- Produces: `isolatedDims(isTouch, screenW, screenH, innerW, innerH): { w: number; h: number }`. On touch, the isolated desktop is viewport-sized (→ the internal web app renders its mobile layout, native touch ~1:1). An `isTouch` value is available in the component for Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/lib/isolated/dims.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isolatedDims } from "./dims";

describe("isolatedDims", () => {
  it("non-touch uses the screen size clamped 1024..2560 / 640..1600", () => {
    expect(isolatedDims(false, 1920, 1080, 1440, 900)).toEqual({ w: 1920, h: 1080 });
    expect(isolatedDims(false, 800, 600, 800, 600)).toEqual({ w: 1024, h: 640 });
    expect(isolatedDims(false, 4000, 3000, 4000, 3000)).toEqual({ w: 2560, h: 1600 });
  });
  it("touch uses the viewport clamped 360..820 / 480..1180", () => {
    expect(isolatedDims(true, 390, 844, 390, 844)).toEqual({ w: 390, h: 844 });
    expect(isolatedDims(true, 320, 400, 320, 400)).toEqual({ w: 360, h: 480 });
    expect(isolatedDims(true, 1200, 2000, 1200, 2000)).toEqual({ w: 820, h: 1180 });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd /opt/captivo-access && npx vitest run src/lib/isolated/dims.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `isolatedDims`**

Create `src/lib/isolated/dims.ts`:
```ts
// Picks the isolated desktop size. On a touch device the remote is sized to the
// phone's viewport so the internal web app renders its mobile/responsive layout at
// ~1:1 (native touch usable); otherwise it matches the vendor's screen. The broker
// keeps this size fixed for the session (recording stays correct).
export function isolatedDims(
  isTouch: boolean,
  screenW: number,
  screenH: number,
  innerW: number,
  innerH: number,
): { w: number; h: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  return isTouch
    ? { w: clamp(innerW, 360, 820), h: clamp(innerH, 480, 1180) }
    : { w: clamp(screenW, 1024, 2560), h: clamp(screenH, 640, 1600) };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd /opt/captivo-access && npx vitest run src/lib/isolated/dims.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire touch detection + sizing into the component**

In `src/app/gateway/[siteId]/session/isolated-client.tsx`:
1. Add the import near the top:
```tsx
import { isolatedDims } from "@/lib/isolated/dims";
```
2. Add an `isTouch` state (used here and by Task 3), computed once:
```tsx
  const [isTouch, setIsTouch] = useState(false);
```
3. Replace the existing dims `useEffect` (the one with `clamp(window.screen.width, 1024, 2560)`) with:
```tsx
  useEffect(() => {
    const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    setIsTouch(touch);
    setDims(isolatedDims(touch, window.screen.width, window.screen.height, window.innerWidth, window.innerHeight));
  }, []);
```

- [ ] **Step 6: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 7: Commit**

```bash
cd /opt/captivo-access
git add src/lib/isolated "src/app/gateway/[siteId]/session/isolated-client.tsx"
git commit -m "feat(isolated): size the remote to the phone viewport on touch devices"
```

---

### Task 3: Mobile input toolbar (soft keyboard + special keys)

**Files:**
- Modify: `src/app/gateway/[siteId]/session/isolated-client.tsx`

**Interfaces:**
- Consumes: `isTouch` + `frameRef` (the same-origin KasmVNC iframe) from Task 2 / existing code.
- Produces: on touch only, a toolbar with a soft-keyboard toggle and Esc/Tab/arrows/Ctrl keys.

**Mechanism note.** The KasmVNC client is noVNC-based; its hidden keyboard input
is `#noVNC_keyboard` inside the same-origin iframe (we already read
`iframe.contentDocument`). Focusing it raises the phone soft keyboard and noVNC
captures typing natively. For special keys we try the RFB API if the bundle
exposes it on the iframe window (`contentWindow.rfb?.sendKey`), else fall back to
dispatching a `KeyboardEvent` on the focused keyboard input. Behavioral
confirmation is the user's post-deploy phone test (no touch device here); both
paths are wired so whichever the embed honors works, and the keyboard toggle —
the core "can't type at all" fix — depends only on focusing the input.

- [ ] **Step 1: Add the keyboard-input accessor + key helpers**

In `src/app/gateway/[siteId]/session/isolated-client.tsx`, inside the component
(after the existing refs/handlers), add:
```tsx
  const [ctrlHeld, setCtrlHeld] = useState(false);

  // The KasmVNC/noVNC hidden keyboard input inside the same-origin iframe. Focusing
  // it raises the phone soft keyboard; noVNC then captures typing.
  const kbInput = (): HTMLElement | null => {
    const doc = frameRef.current?.contentDocument;
    return (doc?.getElementById("noVNC_keyboard") as HTMLElement | null)
      ?? (doc?.querySelector("textarea, input[type=text]") as HTMLElement | null);
  };

  const toggleKeyboard = () => {
    const el = kbInput();
    if (!el) return;
    if (frameRef.current?.contentDocument?.activeElement === el) el.blur();
    else el.focus();
  };

  // Send one special key to the remote. Prefer the RFB API if the bundle exposes it;
  // otherwise dispatch a KeyboardEvent on the focused keyboard input.
  const sendKey = (key: string, code: string, keysym: number) => {
    const el = kbInput();
    if (!el) return;
    el.focus();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rfb: any = (frameRef.current?.contentWindow as any)?.rfb;
    const ctrlSym = 0xffe3, ctrlCode = "ControlLeft";
    if (rfb?.sendKey) {
      if (ctrlHeld) rfb.sendKey(ctrlSym, ctrlCode, true);
      rfb.sendKey(keysym, code, true);
      rfb.sendKey(keysym, code, false);
      if (ctrlHeld) rfb.sendKey(ctrlSym, ctrlCode, false);
    } else {
      const opts: KeyboardEventInit = { key, code, bubbles: true, ctrlKey: ctrlHeld };
      el.dispatchEvent(new KeyboardEvent("keydown", opts));
      el.dispatchEvent(new KeyboardEvent("keyup", opts));
    }
    if (ctrlHeld) setCtrlHeld(false);
  };
```

- [ ] **Step 2: Render the toolbar (touch only)**

Add this block in the returned JSX, gated on `isTouch && ready && dims` (place it
before the `ConnectSplash` line so it sits above the session; keep the dark
translucent style of the other controls):
```tsx
      {isTouch && ready && dims && (
        <div style={{ position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 30, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: "96vw" }}>
          {[
            { label: "⌨", title: "Keyboard", on: toggleKeyboard },
            { label: "Esc", title: "Escape", on: () => sendKey("Escape", "Escape", 0xff1b) },
            { label: "Tab", title: "Tab", on: () => sendKey("Tab", "Tab", 0xff09) },
            { label: "←", title: "Left", on: () => sendKey("ArrowLeft", "ArrowLeft", 0xff51) },
            { label: "↑", title: "Up", on: () => sendKey("ArrowUp", "ArrowUp", 0xff52) },
            { label: "↓", title: "Down", on: () => sendKey("ArrowDown", "ArrowDown", 0xff54) },
            { label: "→", title: "Right", on: () => sendKey("ArrowRight", "ArrowRight", 0xff53) },
          ].map((b) => (
            <button key={b.title} type="button" title={b.title} onClick={b.on}
              style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "8px 12px", fontFamily: "sans-serif", fontSize: 13, cursor: "pointer", minWidth: 40 }}>
              {b.label}
            </button>
          ))}
          <button type="button" title="Ctrl" onClick={() => setCtrlHeld((v) => !v)}
            style={{ background: ctrlHeld ? "rgba(80,160,255,0.85)" : "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "8px 12px", fontFamily: "sans-serif", fontSize: 13, cursor: "pointer", minWidth: 44 }}>
            Ctrl
          </button>
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `cd /opt/captivo-access && pnpm build 2>&1 | tee /tmp/b.txt; grep -q 'Compiled successfully' /tmp/b.txt && ! grep -q 'Type error' /tmp/b.txt && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 4: Commit**

```bash
cd /opt/captivo-access
git add "src/app/gateway/[siteId]/session/isolated-client.tsx"
git commit -m "feat(isolated): touch input toolbar (soft-keyboard toggle + special keys)"
```

---

## Final verification (after all tasks)

- [ ] `cd /opt/captivo-access/dataplane && go build ./... && go test ./...` — green.
- [ ] `cd /opt/captivo-access && npx vitest run src/lib/isolated/dims.test.ts` — green.
- [ ] `cd /opt/captivo-access/kasm-browser && python3 control_test.py` — prints `ok`.
- [ ] `cd /opt/captivo-access && pnpm build` — Compiled successfully.
- [ ] **Manual (post-deploy, needs connector update — SEPARATE approval):** on a phone, open an isolated session → the internal web app shows its **mobile layout**; tap/scroll work; the **⌨ button raises the soft keyboard** and typing lands in the page; **Esc/Tab/arrows/Ctrl** work. Confirm a **desktop** session is visually + behaviorally **unchanged**. If special keys don't register (synthetic-event path rejected by the embed), note it — the keyboard toggle + native typing still deliver the core fix, and the RFB path can be pinned once the exposed object name is known.

## Release (SEPARATE GATES — do not auto-run)

After the user approves deploy: bump the version, tag (CI rebuilds the 5 images), update the prod central stack (manager + data-plane) and the **connector/gateway host** (for the broker clamp floor). On tag, add an English user-focused `gh release edit` note.
