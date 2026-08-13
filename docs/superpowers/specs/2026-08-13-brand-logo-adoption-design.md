# Brand / Logo Adoption (handoff "5b") — Design

**Status:** Approved (handoff read 2026-08-13; decisions: keep teal functional accent, gradient for logo only; logo first, login later).
**Backlog:** punch-list #11, slice 11a of 2 (11b = login redesign, later).
**Ships as:** v0.51.0 (manager only; brand assets + font, no schema, no logic).
**Source:** `/home/jhum/captivo-access/design_handoff_captivo_dashboard/BRAND.md` + `assets/`.

## Goal

Adopt the designed Captivo Access brand mark (keyhole-orbit symbol + "Captivo"
wordmark + gradient-outlined ACCESS badge) across the app, replacing the current
home-grown shield/teal `BrandMark`. **Functional UI accent stays teal** — the
cyan→violet brand gradient is used only for the mark/logo (matches the handoff's
own screens).

## Brand facts (from BRAND.md)

- **Symbol** (viewBox 100×100): open C-arc `M77.98 67.49 A33 33 0 1 1 77.98 32.51`
  (stroke-width 7.5, round caps, gap on the right) + a keyhole dot at the gap
  (evenodd circle r 8.4 at cx 83). Fill/stroke = brand gradient.
- **Gradient** `captivo-g`: `#16C7F0 → #2E84F5 (52%) → #7A5AF5`, `x1=16 y1=12 x2=84 y2=88`.
- **Wordmark**: "Captivo" in **Space Grotesk 600**, letter-spacing −.02em; white
  `#f1f5f9` on dark, ink `#0E1A2D`/`#1c1917` on light.
- **ACCESS chip**: Space Grotesk 600, ~9–10px, letter-spacing .15em, uppercase,
  `border: 1px solid #2E84F5`, radius 5–6, padding ~2px 7px; text `#7c8aa5` on
  dark, `#57534e` on light.
- Single-color fallback `#2E84F5`. Don't recolor the gradient or swap the keyhole
  for a plain dot.

## Changes

### 1. Font — Space Grotesk

`src/app/layout.tsx`: add `Space_Grotesk` via `next/font/google` (weight 600,
`variable: "--font-grotesk"`), append its `.variable` to the `<html>` className.
`globals.css`: `--grotesk: var(--font-grotesk), "Space Grotesk", system-ui, sans-serif;`

### 2. `BrandMark` symbol — `src/components/brand.tsx`

Replace the shield SVG with the orbit-keyhole symbol (viewBox 100×100, the two
paths above, `stroke/fill="url(#ca-orbit)"`, gradient def inline). Keep the
`{ size, className }` API so every current consumer (topnav + setup/login/recover/
invite) picks it up unchanged. Gradient id fixed `ca-orbit` (one mark per page).

### 3. Reusable lockup — `src/components/brand.tsx` → `BrandLockup`

Add `BrandLockup({ size?, className? })`: `<BrandMark>` + `<span class="brand-word">Captivo</span>` + `<span class="brand-access">Access</span>`, in a centered flex row (gap 10). Theme-aware via CSS (below). Export alongside `BrandMark`.

### 4. CSS — `globals.css`

```css
.brand-lockup { display:inline-flex; align-items:center; gap:10px; }
.brand-word { font-family:var(--grotesk); font-weight:600; letter-spacing:-.02em; font-size:1.05rem; color:var(--fg); }
.brand-access { font-family:var(--grotesk); font-weight:600; font-size:.62rem; letter-spacing:.15em; text-transform:uppercase; color:var(--muted); border:1px solid #2E84F5; border-radius:6px; padding:2px 7px; }
/* On the dark nav bar, the lockup uses nav tokens. */
.tn-brand .brand-word { color:#fff; }
.tn-brand .brand-access { color:var(--nav-fg-dim); }
```

### 5. Top-nav — `src/app/(app)/_shell/topnav.tsx`

Replace `<span className="tn-word"><b>Captivo</b> <span className="tn-sub">Access</span></span>`
with `<span className="brand-word">Captivo</span><span className="brand-access">Access</span>`
(the existing `<BrandMark size={26} />` stays; it now renders the new symbol).
The old `.tn-word`/`.tn-sub` rules can be dropped (only used here).

### 6. Auth surfaces — `src/components/auth-shell.tsx`

Replace the inline shield `<svg>` in `.auth-panel-mark` with `<BrandMark size={26} />`,
and the `.auth-panel-word` text "Captivo Access" with the `brand-word` + `brand-access`
spans (light styling — the panel is a dark gradient, so force white via a scoped
rule `.auth-panel .brand-word{color:#fff} .auth-panel .brand-access{color:#c7d2e0}`).
The setup/login/recover/invite pages already render `<BrandMark>` — no change needed
beyond the symbol swap.

### 7. Favicon — `src/app/icon.svg`

Replace with the gradient keyhole symbol (the `captivo-access-symbol-gradient.svg`
contents), so the browser tab + PWA icon show the new mark. Keep `favicon.ico` as-is
(legacy fallback) or leave it.

## Out of scope (this slice)

- The 3-step login redesign (slice 11b).
- Any functional-accent retheme (teal stays).
- Marketing/README brand updates.

## Testing

- No unit test (assets/markup). `pnpm build` typechecks + confirms `next/font` loads
  Space Grotesk.
- Gate-A (after deploy): the new orbit-keyhole mark shows in the top-nav, on the
  login/setup/recover/invite screens, and as the browser-tab favicon; "Captivo" is
  in Space Grotesk with the bordered ACCESS chip; light + dark both legible; the rest
  of the UI is unchanged (teal accent intact).

## Deploy

**v0.51.0**, manager only. Bump the manager tag, `docker compose up -d access-manager`.
