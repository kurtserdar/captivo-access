# Session Control Panel + On-Screen Keyboard — Design

**Date:** 2026-08-15
**Status:** Approved (design)
**Scope:** GATEWAY (Guacamole) and ISOLATED (KasmVNC) full-screen sessions. Web-app
(`TRANSPARENT`) sessions are excluded — they are real DOM pages and need none of this.

## Problem

Pixel-streamed sessions (gateway RDP/SSH/VNC and isolated browser) are hard to
operate: special keys (Esc, Tab, F-keys, arrows, `Ctrl+Alt+Del`) are awkward or
impossible from a normal browser, and our session controls (fullscreen, file
transfer, clipboard status, the nascent mobile key bar) are scattered as floating
buttons across two large client files. Kasm's session UX — a collapsible
edge-docked control panel plus a full on-screen keyboard — is the pattern to
adopt, branded as Captivo and populated only with controls that fit our model.

## Goal

A single, branded, collapsible **Session Control Panel** and a **full on-screen
keyboard**, shared by both pixel-streamed session types, that:
1. consolidates the scattered controls (fullscreen, file transfer, clipboard
   status, leave) into one edge-docked panel;
2. adds a full QWERTY + special-keys on-screen keyboard (F-keys, nav cluster,
   arrows, sticky modifiers for chording like `Ctrl+Alt+Del`);
3. works on both stacks through a small per-stack adapter, with **one X11-keysym
   map** driving both;
4. keeps compliance notices (RECORDED / being-monitored) always visible — they
   are never hidden inside the panel.

## Architecture

Both session types are an outer React page wrapping a pixel surface
(`session-client.tsx` → guacamole-common-js `<canvas>`; `isolated-client.tsx` →
KasmVNC `<iframe>`). Both files are already large (345 / 282 lines) with scattered
controls. Introduce two shared, presentation components and a per-stack adapter,
then refactor both pages to use them (a decluttering refactor as much as a feature).

### Shared components

- **`SessionControlPanel`** — a left edge-docked handle that slides out a branded
  panel. Renders a list of *actions* it is given; unknown/omitted actions simply
  don't appear (so per-stack/per-site differences are just different props).
- **`OnScreenKeyboard`** — a right edge-docked handle (keyboard icon) that slides
  up a full keyboard from the bottom. Full QWERTY + Esc/F1-F12 + number row +
  modifiers (Ctrl/Super/Alt/Menu) + nav cluster (Ins/Home/PgUp/Del/End/PgDn) +
  arrows. Ctrl/Alt/Shift are **sticky** (press once → armed → next key chords →
  auto-release), enabling `Ctrl+Alt+Del`, `Ctrl+C`, etc.

Both are pure presentation + a callback interface; they hold no
stack-specific logic.

### Per-stack adapter

Each session page constructs an adapter object and passes it to the shared
components:

```
interface SessionAdapter {
  sendKey(keysym: number, pressed: boolean): void;   // X11 keysym
  fullscreen(): void;                                 // toggle document fullscreen
  fileTransfer?: { upload?: () => void; hasDownloads?: boolean }; // present only if applicable
  clipboard?: { status: string; open?: () => void };  // status text + optional panel opener
  leave(): void;                                       // disconnect / end session
}
```

- **Gateway adapter (`session-client.tsx`):** `sendKey` → the guacamole client's
  `sendKeyEvent(pressed ? 1 : 0, keysym)` (clean, trusted). `clipboard.open` →
  the existing Ctrl+Alt+Shift clipboard panel. File transfer uses guacd's native
  drag-drop (already audited) — an explicit Upload button is optional and may be
  omitted in v1.
- **Isolated adapter (`isolated-client.tsx`):** `sendKey` → the KasmVNC RFB
  object's `sendKey` if the bundle exposes it on the iframe window, else a
  synthetic `KeyboardEvent` on the hidden `#noVNC_keyboard` input (the mechanism
  already in `isolated-client.tsx`). `fileTransfer` → the existing upload button +
  downloads tray, gated by `fileTransferMode`. `clipboard.status` from the site's
  `clipboardMode`.

**One X11-keysym map** (module constant) is shared: both guacamole `sendKeyEvent`
and noVNC `RFB.sendKey` take X11 keysyms, so each on-screen key carries its keysym
and the same map drives both stacks.

## Control Panel contents (per-stack aware)

| Item | Gateway | Isolated | Notes |
|---|---|---|---|
| Fullscreen | ✅ | ✅ | document fullscreen toggle |
| Keyboard | ✅ | ✅ | opens the on-screen keyboard (also reachable via the right handle) |
| File transfer | native drag-drop (optional button) | Upload + Downloads (if `fileTransferMode` allows) | isolated shows per-DLP |
| Clipboard | status + open existing panel | status (from `clipboardMode`) | status indicator, not a security toggle |
| Leave session | ✅ | ✅ | disconnect; Terminate stays admin-side |

## Edge handles + branding

Two minimal, always-present edge tabs (Kasm pattern, Captivo-branded — navy tab,
verified-teal accent, per the existing design tokens in `globals.css`):
- **left handle → Control Panel** (slides out from the left),
- **right handle → on-screen keyboard** (slides up from the bottom).

Both collapse to a small tab so the remote screen stays unobstructed; each closes
with an X.

## Compliance notices stay visible

The **RECORDED** badge and the **"this session is being monitored" / "an
administrator has taken control"** notices are **not** moved into the collapsible
panel. They remain always-on overlays (KVKK/5651 transparency). The panel is for
user *controls* only; compliance *notices* are separate and permanent.

## Honest risk (accepted)

- **Gateway: solid.** `sendKeyEvent` is a trusted API — the full keyboard + panel
  work reliably.
- **Isolated: key-send is uncertain.** If the KasmVNC bundle exposes its RFB
  object we use `RFB.sendKey` (clean); otherwise synthetic `KeyboardEvent`s, which
  the embed may ignore. A short spike during implementation pins which. If the
  full on-screen QWERTY proves unreliable on isolated, we degrade it there to the
  soft-keyboard toggle + special keys (letters via the device keyboard) while
  gateway keeps the full keyboard. Worst case, we revert the isolated adapter and
  keep the gateway panel — the shared design makes that a clean rollback.

## Non-goals

- No Kasm-platform items we don't have: Sound, Microphone, Printer Redirection,
  Workspaces.
- No streaming-quality control in v1 (possible later for gateway's guacd image
  quality).
- No change to web-app (`TRANSPARENT`) sessions.
- No change to recording, clipboard DLP enforcement (server-side), file-transfer
  DLP, live-view/terminate, or audit.

## Testing

- **Unit:** the X11-keysym map (a pure module) — a few representative keys map to
  the correct keysyms; sticky-modifier state machine (arm → chord → auto-release)
  as a pure reducer with tests.
- **Component build:** `pnpm build` typecheck after the refactor of both pages.
- **Manual (post-deploy):** on gateway (RDP), open the panel + keyboard, send
  `Ctrl+Alt+Del`, F-keys, arrows; fullscreen; leave. Confirm the isolated adapter
  (keyboard toggle at minimum) works. Confirm RECORDED / monitored badges stay
  visible with the panel open. Confirm web-app sessions are unchanged.

## Release

Deploy + release notes are separate standing gates — do NOT auto-run. This is a
manager-only change (client UI) — no data-plane or broker change — so it deploys
with the central stack; the connector needs no update. On tag, add an English
user-focused `gh release edit` note.
