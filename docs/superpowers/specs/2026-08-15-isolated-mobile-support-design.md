# Isolated Browser — Mobile (Touch) Support — Design

**Date:** 2026-08-15
**Status:** Approved (design)
**Scope:** ISOLATED (KasmVNC) sessions on touch devices, phone-priority. (GATEWAY/Guacamole mobile support is a later, separate slice.)

## Problem

On a touch device, an isolated-browser session is unusable: the vendor cannot
move the pointer or type. The session is a **canvas** streaming pixels from a
server-side Chromium — it has no real DOM inputs, so:
- tapping a field in the remote page does **not** raise the phone's soft
  keyboard (there is no focusable input; the "field" is just pixels), and
- the isolated desktop is created at a **minimum 1024 px width** (clamped in
  three layers), so on a ~390 px phone it renders a desktop-layout page scaled
  down to microscopic — targets are unhittable even if touch worked.

Web-app (`TRANSPARENT`) Resources are unaffected: those are real proxied HTML
pages with native inputs.

## Key insight — an isolated session is a *browser*

Because the isolated tail runs a real Chromium, **sizing the remote desktop to
the phone's viewport makes the internal web app render its own mobile/responsive
layout** — natively sized, legible, finger-friendly. This is a bigger usability
win than any input trick, and at ~1:1 it makes plain absolute touch natural. So
the design is "make the remote phone-shaped," not "emulate a trackpad."

## Goal

On a **touch device**, an isolated session:
1. sizes the remote desktop to the phone's viewport → the web app goes
   responsive, shown ~1:1;
2. lets the vendor tap to click / drag / two-finger-scroll (native pointer);
3. raises the soft keyboard on demand and types into the remote page;
4. offers a small set of keys a web app needs (Esc, Tab, arrows, Ctrl).

Desktop (fine-pointer) sessions are **completely unchanged**.

## Approach

Detect touch, size the remote to the viewport (requires relaxing the min-width
clamp in all three layers), and add a **mobile-only input toolbar** in the outer
session page. No trackpad/relative-cursor mode in v1 (parked — the ~1:1 sizing
makes absolute touch workable).

### 1. Touch detection (`isolated-client.tsx`)

`const isTouch = window.matchMedia("(pointer: coarse)").matches;` computed once
on mount. Drives both the dimensions (below) and whether the mobile toolbar
renders. Everything mobile is gated on `isTouch`, so desktop is untouched.

### 2. Mobile desktop sizing

Currently the client sends `clamp(window.screen.width, 1024, 2560)` ×
`clamp(window.screen.height, 640, 1600)`; the data-plane
(`clampKasmDim(_, 1024, 2560, 1280)`) and broker
(`_clamp_dim(_, 1024, 2560, 1280)`) re-clamp to the same 1024/640 minimums. All
three must permit a phone-sized desktop.

- **Client (`isolated-client.tsx`):** when `isTouch`, send the actual viewport:
  `w = clamp(window.innerWidth, 360, 820)`, `h = clamp(window.innerHeight, 480, 1180)`.
  Non-touch keeps the existing screen-based clamp. (Portrait phone → ~390×840 →
  Chromium renders the mobile layout; 820 max keeps tablets/landscape reasonable
  without going full-desktop.)
- **Data-plane (`kasmtunnel.go`):** lower the `clampKasmDim` minimums to
  `clampKasmDim(kasmW, 360, 2560, 1280)` and `clampKasmDim(kasmH, 480, 1600, 800)`.
- **Broker (`control.py`):** lower the `_clamp_dim` minimums to
  `_clamp_dim(data.get("w"), 360, 2560, 1280)` and
  `_clamp_dim(data.get("h"), 480, 1600, 800)`.

Lowering the floor is safe: desktop clients still send ≥1024 (they clamp on
`window.screen`), and the unset **default stays 1280×800**. Only genuinely small
(mobile) clients get a small desktop.

`resize=scale` and the fixed-desktop model are **kept** (a server-side resize
broke recording before — the x11grab region is fixed). At mobile size the scale
is ~1:1, so no letterbox and the recording stays correct.

### 3. Mobile input toolbar (`isolated-client.tsx`, `isTouch` only)

A compact bar (rendered only on touch, positioned to avoid the existing
fullscreen / upload / download controls) with:

- **Keyboard toggle** — focuses KasmVNC's hidden keyboard input inside the
  same-origin iframe to raise/dismiss the phone's soft keyboard. (We already
  read `iframe.contentDocument` for the `noVNC_connected` class, so reaching the
  input is the same mechanism. The element id observed in the bundle is
  `noVNC_keyboard`; the exact selector is confirmed in the spike below.)
- **Special-keys row** — Esc, Tab, ←↑↓→, and a sticky **Ctrl** modifier, each
  sending the corresponding key to the remote (mechanism from the spike).

The bar auto-hides in fullscreen if it would crowd the view, or stays as a thin
strip — a UI detail, not a correctness concern.

### 4. Ensure touch reaches the pointer

At mobile size, noVNC's built-in touch→pointer handling should make tap/drag/
two-finger-scroll work. This is **verified in the spike**; if native touch does
not reach the canvas in our embed, the fallback is forwarding touch as pointer
events to the iframe canvas (mechanism from the spike).

## Spike (first implementation step — resolves the embed unknowns)

Before building the toolbar, a short spike on a real touch device (or emulation)
against a live isolated session confirms, inside the same-origin iframe:
1. **Touch→pointer:** does tapping/dragging move + click the remote pointer once
   the desktop is phone-sized? If not, what reaches the canvas?
2. **Soft keyboard:** which element to focus to raise it (expected
   `#noVNC_keyboard`), and that typed characters reach the remote page.
3. **Key send:** how to send Esc/Tab/arrows/Ctrl — the KasmVNC RFB object if it
   is exposed on the iframe window, else a synthetic `KeyboardEvent` on the
   focused keyboard input.

The spike's findings pin the two "mechanism from the spike" points above. The
rest of the design (detection, sizing, toolbar shell) is independent of them.

## Non-goals

- **GATEWAY (Guacamole) mobile support** — separate, larger slice (custom touch
  + on-screen keyboard wiring).
- **Trackpad/relative-cursor mode** — parked; the mobile-size approach makes
  absolute touch workable. Revisit only if precision proves insufficient.
- **SSH-as-terminal (xterm.js)** — separate track.
- **Tablet-specific tuning** — same architecture serves tablets; phone is the
  ergonomic target. No separate tablet code.
- No change to recording (beyond the naturally smaller mobile resolution),
  clipboard, watermark, file transfer, or the live-view/terminate paths.

## Compatibility & impact

- Desktop sessions: **no change** (all mobile behavior is `isTouch`-gated;
  clamp floors only lowered, and desktop never sends sub-1024 dims).
- Recording: mobile sessions record at their (smaller) mobile resolution —
  fine; seeking/finalize unchanged.
- The change spans **manager** (client UI), **data-plane** (clamp floor), and
  **broker/kasm-browser** (clamp floor) — so deploy touches the central stack
  *and* requires the connector/gateway host to update for the broker floor.

## Testing

- **Client:** unit-test the dimension helper — touch vs non-touch produces
  viewport-based vs screen-based dims with the new bounds (extract the sizing
  into a pure function to test without a DOM).
- **Data-plane:** extend the existing `clampKasmDim` coverage for the new
  min (e.g., 400 stays 400, 100 → 360).
- **Broker:** extend `control_test.py` for `_clamp_dim` new min.
- **Build:** `pnpm build`, `go build`/`go test`, broker byte-compile + test.
- **Manual (post-deploy, needs connector update):** on a phone, open an isolated
  session → the internal web app shows its mobile layout, tap/scroll/type work,
  the keyboard toggle raises the soft keyboard, Esc/Tab/arrows/Ctrl work; confirm
  desktop sessions are visually and behaviorally unchanged.

## Release

Deploy + release notes are separate standing gates — do NOT auto-run. On tag,
add an English user-focused `gh release edit` note. The broker floor change is
connector-side, so it takes effect once the connector/gateway host is updated.
