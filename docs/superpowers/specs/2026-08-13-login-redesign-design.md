# Login / Auth Redesign (handoff 3b+4a) — Design

**Status:** Approved (brainstorm 2026-08-13). Decisions: keep discoverable one-tap passkey (no email step); apply the dark-centered frame to all four pre-login screens; step-3 = active-grants list + "Go to my access".
**Backlog:** punch-list #11, slice 11b of 2 (11a brand mark shipped v0.51.0).
**Ships as:** v0.52.0 (manager only; UI + one read endpoint, no schema).
**Source:** `design_handoff_captivo_dashboard/` (3b login step 1, 4a steps 2–3), README "Login flow" tokens.

## Goal

Adopt the handoff's dark, centered auth look for the pre-login screens, and turn
login into a guided 3-state flow — **without** changing the security model: it
stays **discoverable-credential** passkey (one tap, no email/identifier). After a
successful passkey verify, show the user's active grants + a "Go to my access"
button instead of an immediate redirect.

## Frame — `AuthShell` becomes dark-centered (all 4 screens)

`src/components/auth-shell.tsx`: replace the split `.auth` grid (marketing panel +
form) with a centered column on a **fixed-dark** backdrop (the auth frame is dark
in both app themes, like the nav island):

- Backdrop: `radial-gradient(900px 500px at 50% -10%, #0f2a26 0%, #0a0f1a 60%), #0a0f1a` + a dot-grid overlay (`radial-gradient(circle,#1b2436 1px,transparent 1px)` 28px cell, opacity .5).
- Centered stack: the brand **`<BrandLockup>`** (white on dark) near the top, the **card** below, and a mono tagline `open-source · self-hosted · vpn-less` under it.
- Card: `width:min(92vw,440px)`, bg `#0d1424`, border `1px #1b2436`, radius 16, shadow `0 20px 60px rgba(0,0,0,.5)`. A faux terminal title bar (three 9px dots left, `auth.captivo.io` mono 10px `#4a5872` right, bar bg `#0b111f`). Card body padding 32×36; text left-aligned.
- The pages' existing `<h1>` + `<p>` + form render inside `.auth-card` unchanged.
  The per-page `<BrandMark className="auth-mark">` is hidden (`.auth-mark{display:none}`) since AuthShell now always shows the lockup.

All CSS is fixed dark hex (not theme tokens) so the frame looks identical in light
and dark app themes. New classes replace the old `.auth-panel*` rules (removed).

## Login states — `src/app/login/login-form.tsx` (rebuilt)

A 3-state client component with a 3-segment step indicator (3px bars, done/current
`#2dd4bf`, upcoming `#1b2436`). Discoverable — **no email input**.

1. **Rest** (segment 1): the page heading "Sign in" (kept), trust line
   `● MFA enforced · recorded · zero-trust` (mono 11px, teal dot), primary
   **"Sign in with passkey"** button (teal `#2dd4bf` fill, ink text). If SSO is
   configured, an "or" divider + "Continue with <provider>" ghost button (full-page
   OIDC — no ceremony/step-3).
2. **Ceremony** (segment 2): shown while `startAuthentication` runs — a dashed
   WebAuthn zone (`1px dashed #1b2436`, radius 12, bg `#0a0f1a`) with a 64px circle
   (`#0f2a26`/`#134e4a`) + teal spinner ring + "Waiting for your passkey…"; a
   ghost "Use a different device" retry. On error, return to Rest with the message
   (+ "Recover your account" link, as today).
3. **Access-ready** (segment 3): a ✓ badge (`#0f2a26`/`#134e4a`, teal check) +
   "You're in", then the user's **active grants** list (rows: type chip + resource
   name + window meta), and a primary **"Go to my access"** button → `returnTo`.

The existing verify flow is unchanged: `POST /authentication/options` →
`startAuthentication` → `POST /authentication/verify` (returns `{ ok: true }`,
sets the session cookie). On `ok`, the component fetches step-3 grants (below) and
switches to the access-ready state instead of `window.location.href`.

## Step-3 data — `GET /api/access/my-grants` (new)

Session-gated (`getCurrentUser` → 401). Returns the caller's **active** grants,
lightweight for display:

```ts
{ grants: { id: string; siteName: string; accessMode: "TRANSPARENT" | "GATEWAY"; window: string }[] }
```

Built from `listUserGrants(user.id)` filtered to `classifyGrant(g, now) === "allow"`,
mapping `window` via the portal's `remaining()`/window text (or a simple
start→end string). No per-row "Open" link — "Go to my access" is the single CTA
(keeps it light; `returnTo` = `/` self-routes vendor→/access, admin→console).

## Other screens (setup / recover / invite)

Unchanged content — each still renders its `<h1>` + `<p>` + form as `AuthShell`
children, now inside the new centered dark card. No step indicator, no step-3.
Consistent frame across all four.

## Non-goals / guardrails

- **No email/identifier step** — discoverable stays (security + UX). No username
  enumeration surface added.
- **No schema change.** No functional-accent change (teal stays; button teal).
- SSO path is unchanged (full-page redirect; no ceremony visuals).
- Don't regress the existing error handling (rate_limited, revoked, challenge
  expired → generic message + recover link).

## Testing

- `GET /api/access/my-grants`: no unit harness for routes (consistent with the
  repo); validated by build + Gate-A.
- Reuse of `classifyGrant`/`listUserGrants` is already unit-tested.
- `pnpm build` typechecks the rebuilt form + endpoint + AuthShell.
- Gate-A (after deploy): login shows the dark centered card + lockup + terminal
  bar; "Sign in with passkey" → passkey prompt → ceremony spinner → access-ready
  with the grants list → "Go to my access" lands correctly; SSO still works;
  wrong/cancelled passkey → error + recover link; setup/recover/invite render in
  the new frame; light + dark app themes both show the (dark) auth identically.

## Deploy

**v0.52.0**, manager only. Bump the manager tag, `docker compose up -d access-manager`.
