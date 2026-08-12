# Gateway Clipboard Sync — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** Clipboard (text) for GATEWAY remote-desktop sessions (RDP / SSH / VNC), following E1 (guac params) and E2 (file transfer).

## Problem

In TRANSPARENT (webapp) resources the browser talks to the app directly, so the OS/browser clipboard works natively. In GATEWAY resources the session runs through guacd and our custom client (`src/app/gateway/[siteId]/session/session-client.tsx`), which never wired up clipboard — so copy/paste between the vendor's machine and the remote desktop does not work.

The direction gate already exists: `Site.clipboardMode` (`allow | no_copy | no_paste | none`, default `allow`) is mapped to guacd `disable-copy` / `disable-paste` in `toGuacArgs` (`src/lib/gateway/guac-params.ts`). guacd enforces direction server-side today. What is missing is the **browser ↔ guacd clipboard bridge** in the client.

## Scope

- **Text only** (`text/plain`). Images are out of scope — users who need to move images use file transfer (E2).
- Both directions, gated by `clipboardMode`.
- Two cooperating layers:
  - **Automatic** (Clipboard API): seamless sync where the browser allows it (Chromium).
  - **Manual panel** (universal fallback): a keyboard-shortcut overlay with a `<textarea>` — native paste/copy into a textarea needs no permission, so it works in every browser (Firefox included) and whenever the automatic layer is blocked.
- English-only UI. No schema change (reuses `Site.clipboardMode`).

## Direction semantics

`clipboardMode → { allowCopyOut, allowPasteIn }`:

| clipboardMode | allowCopyOut (remote → browser) | allowPasteIn (browser → remote) |
|---|---|---|
| `allow`    | true  | true  |
| `no_copy`  | false | true  |
| `no_paste` | true  | false |
| `none`     | false | false |

- **copy-out** = remote clipboard leaves the session to the vendor's machine (exfiltration surface) → gated by `no_copy` (guacd `disable-copy`).
- **paste-in** = vendor's clipboard enters the remote session → gated by `no_paste` (guacd `disable-paste`).

guacd remains authoritative; the client mirrors the same gate so it does no pointless work and the UI stays consistent (defense in depth).

## Components

### `src/lib/gateway/clipboard-caps.ts` (new, pure + unit-tested)

```ts
export interface ClipboardCaps { allowCopyOut: boolean; allowPasteIn: boolean }
export function clipboardCaps(mode: string): ClipboardCaps {
  return {
    allowCopyOut: mode !== "no_copy" && mode !== "none",
    allowPasteIn: mode !== "no_paste" && mode !== "none",
  };
}
```

### `src/app/gateway/[siteId]/session/clipboard.ts` (new)

`createClipboardBridge(client, Guacamole, caps)` returns a small handle and installs `client.onclipboard`. It is the single owner of clipboard protocol wiring; the component never touches guac clipboard primitives directly.

- **remote → local (`client.onclipboard`)**: `new Guacamole.StringReader(stream)`; accumulate `.ontext`; on `.onend` store `remoteText`. If `caps.allowCopyOut` and `navigator.clipboard?.writeText` exists, best-effort `writeText(remoteText)` (try/catch, silent on failure). Non-text mimetypes are ignored.
- **`syncFromBrowser()`**: if `caps.allowPasteIn` and `navigator.clipboard?.readText` exists, read text; if it differs from the last value pushed, call `pushLocal(text)`. All in try/catch, silent on failure (permission denied / Firefox).
- **`pushLocal(text)`**: if `caps.allowPasteIn` and `text` non-empty: `const s = client.createClipboardStream("text/plain"); const w = new Guacamole.StringWriter(s); w.sendText(text); w.sendEnd();` Record `lastPushed = text` (dedupe).
- **`getRemoteText()`**: returns the last `remoteText` (for the panel).

Return shape: `{ syncFromBrowser, pushLocal, getRemoteText }`.

### `src/app/gateway/[siteId]/session/session-client.tsx` (modify)

- New prop `clipboardMode: string`; compute `caps = clipboardCaps(clipboardMode)`.
- After the guac client connects, create the bridge and keep it in a ref.
- **Automatic paste-in trigger**: on `window` `focus` (and once right after `ready`), call `bridge.syncFromBrowser()`. Registered/unregistered in the session effect cleanup.
- **Manual panel** (React state `clipboardOpen`):
  - **Open shortcut** — a *capture-phase* `document` `keydown` listener (added before/around guac's `Guacamole.Keyboard`, using `capture: true`) that fires when `e.ctrlKey && e.altKey && e.shiftKey` are all held (the Guacamole convention). On match: `e.preventDefault()`, `e.stopImmediatePropagation()`, then open the panel. This runs only when the panel is closed.
  - **Suspend guac keyboard while open**: on open, call `keyboard.reset()` (release Ctrl/Alt/Shift already sent to the remote so no modifier sticks) and detach the guac keyboard handlers (set `keyboard.onkeydown/onkeyup = null`) so keystrokes go to the textarea, not the remote. On close, re-attach them.
  - **Panel UI**: a small centered overlay with one `<textarea>`, auto-focused on open.
    - On open, if `caps.allowCopyOut`, prefill the textarea with `bridge.getRemoteText()` so the vendor can select + native-copy it out (no permission needed). If `!allowCopyOut`, prefill empty.
    - If `caps.allowPasteIn`, the textarea is editable and the panel shows one **"Send to session"** button; clicking it calls `bridge.pushLocal(textarea.value)` and closes the panel. (Single explicit trigger — no per-keystroke pushing.) If `!allowPasteIn`, the textarea is `readOnly` and the button is hidden.
    - If `!allowCopyOut && !allowPasteIn` (mode `none`), the shortcut still opens the panel but it shows a short "Clipboard is disabled for this resource." message and no textarea.
  - **Close**: `Esc` key (handled while panel open) or a close button → re-enable guac keyboard, clear `clipboardOpen`.
- Overlays live in the existing sibling-of-display layer (same pattern as the RECORDED badge and file-transfer toast) so guac's `innerHTML` clear never wipes them.

### `src/app/gateway/[siteId]/session/page.tsx` (modify)

- Add `clipboardMode: true` to the `db.site.findUnique` select.
- Pass `clipboardMode={site.clipboardMode}` to both `<GatewaySession>` and `<ConsentGate>`.

### `src/app/gateway/[siteId]/session/consent-gate.tsx` (modify)

- Add `clipboardMode: string` to `ConsentGate` props and forward it to `<GatewaySession>`.

## Data flow summary

```
Remote copy (Ctrl+C in app)
  → guacd → client.onclipboard → StringReader → remoteText
  → (allowCopyOut) navigator.clipboard.writeText  ── seamless
  → panel prefill (fallback: user selects + native-copies)

Vendor copy elsewhere → focus session
  → window focus → syncFromBrowser → navigator.clipboard.readText ── seamless
  → pushLocal → createClipboardStream + StringWriter → guacd → remote clipboard
Fallback (Firefox / denied): open panel (Ctrl+Alt+Shift) → paste into textarea
  → pushLocal → guacd → remote clipboard, then Ctrl+V in the session
```

## Error / permission handling

- Every `navigator.clipboard.*` call is wrapped in try/catch and fails silently — the manual panel is always the guaranteed path, so no error toasts or console spam.
- Clipboard API requires a secure context; prod is HTTPS. If the API is entirely absent, the automatic layer no-ops and the panel is the only path.
- guacd enforces direction regardless of client state; a client that pushes into a `no_paste` session is simply dropped server-side, but the client also gates to avoid it.

## Testing

- **Unit**: `clipboard-caps.test.ts` — the four `clipboardMode` values → expected `{ allowCopyOut, allowPasteIn }` (mirrors the existing `guac-params` test style).
- **Manual** (live gateway, like E1/E2): (1) RDP copy-out auto (Chromium), (2) RDP paste-in auto on focus, (3) manual panel copy-out + paste-in (test in Firefox), (4) `no_copy` blocks out but allows in, (5) `no_paste` blocks in but allows out, (6) `none` shows disabled panel, (7) opening the panel does not leave Ctrl/Alt/Shift stuck in the remote, (8) SSH and VNC text clipboard.

## Out of scope

- Image/rich clipboard (use file transfer).
- Clipboard history / audit of clipboard contents.
- A visible on-screen clipboard button (shortcut only, by decision).
