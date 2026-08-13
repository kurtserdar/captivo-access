# Login / Auth Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the pre-login screens a dark, centered look and turn login into a guided 3-state passkey flow ending in an active-grants "you're in" screen — without changing the discoverable (no-email) security model.

**Architecture:** `AuthShell` becomes a fixed-dark centered frame (brand lockup + terminal-chrome card + dot-grid backdrop + tagline) shared by setup/login/recover/invite. `LoginForm` is rebuilt as a 3-state client component (rest → ceremony → access-ready) that owns the whole card body (step indicator + per-state heading). A new `GET /api/access/my-grants` feeds the access-ready grant list.

**Tech Stack:** Next.js (App Router), React client component, `@simplewebauthn/browser`, vitest.

## Global Constraints

- **English only** — code, comments, commit messages. **No Claude signature.**
- **Manager-only**, no schema, no dataplane, no connector. Ships as **v0.52.0**.
- **Discoverable stays** — no email/identifier input, no username-enumeration surface. Verify flow (`/api/auth/authentication/options` → `startAuthentication` → `/api/auth/authentication/verify` → `{ ok: true }` + session cookie) is unchanged.
- **Teal functional accent unchanged.** The auth frame is **fixed dark** (same in both app themes). Primary button teal `#2dd4bf`, ink text `#04211c`.
- Preserve existing login error handling (revoked → specific copy; else generic + "Recover your account" link).
- Manager tests: `pnpm test`; typecheck: `pnpm build`.

---

### Task 1: `GET /api/access/my-grants`

**Files:**
- Create: `src/app/api/access/my-grants/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (`@/lib/current-user`), `listUserGrants` (`@/lib/access/grants`), `classifyGrant` (`@/lib/access/evaluate`).
- Produces: `GET /api/access/my-grants` → `{ grants: { id: string; siteName: string; accessMode: "TRANSPARENT" | "GATEWAY"; endsAt: string | null; scheduled: boolean }[] }` (active grants only).

- [ ] **Step 1: Write the route**

Create `src/app/api/access/my-grants/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { listUserGrants } from "@/lib/access/grants";
import { classifyGrant } from "@/lib/access/evaluate";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const grants = (await listUserGrants(user.id))
    .filter((g) => classifyGrant(g, now) === "allow")
    .map((g) => ({
      id: g.id,
      siteName: g.site.name,
      accessMode: g.site.accessMode as "TRANSPARENT" | "GATEWAY",
      endsAt: g.endsAt ? g.endsAt.toISOString() : null,
      scheduled: g.schedule != null,
    }));

  return NextResponse.json({ grants });
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build`
Expected: Compiles; `/api/access/my-grants` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/access/my-grants/route.ts"
git commit -m "feat(auth): my-grants endpoint (active grants for the login access-ready step)"
```

---

### Task 2: `AuthShell` → dark-centered frame + CSS

**Files:**
- Modify: `src/components/auth-shell.tsx`
- Modify: `src/app/globals.css` (replace the `.auth*` block)

**Interfaces:**
- Consumes: `BrandLockup` (`@/components/brand`, shipped v0.51.0).
- Produces: the centered dark frame; children render inside `.auth-card`.

- [ ] **Step 1: Rewrite AuthShell**

Replace the whole file `src/components/auth-shell.tsx` with:

```tsx
import { BrandLockup } from "@/components/brand";

// Shared frame for the pre-login screens (setup / login / recover / invite):
// a centered card on a fixed-dark dotted backdrop, brand lockup above, tagline
// below. Purely presentational — the page's content is the card body.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="authx">
      <BrandLockup size={30} className="authx-lockup" />
      <div className="authx-card">
        <div className="authx-bar" aria-hidden="true">
          <span className="authx-dots"><i /><i /><i /></span>
          <span className="authx-host">auth.captivo.io</span>
        </div>
        <div className="authx-body">{children}</div>
      </div>
      <div className="authx-tag">open-source · self-hosted · vpn-less</div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the auth CSS**

In `src/app/globals.css`, replace the entire old auth block (every rule from
`.auth{...}` through `.auth-card .btn.primary{...}`, i.e. the `.auth`,
`.auth-panel*`, `.auth-main`, `.auth-card*`, `.auth-mark`, and the `@media
(max-width:680px)` auth rule) with:

```css
/* ---- pre-login auth frame: fixed-dark centered card ---- */
.authx{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.1rem;padding:2rem 1.2rem;
  background:radial-gradient(900px 500px at 50% -10%, #0f2a26 0%, #0a0f1a 60%), #0a0f1a;position:relative;}
.authx::before{content:"";position:absolute;inset:0;background-image:radial-gradient(circle,#1b2436 1px,transparent 1px);background-size:28px 28px;opacity:.5;pointer-events:none;}
.authx>*{position:relative;}
.authx-lockup .brand-word{color:#f1f5f9;} .authx-lockup .brand-access{color:#7c8aa5;}
.authx-card{width:min(92vw,440px);background:#0d1424;border:1px solid #1b2436;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;}
.authx-bar{display:flex;align-items:center;justify-content:space-between;padding:.5rem .8rem;background:#0b111f;border-bottom:1px solid #1b2436;}
.authx-dots{display:inline-flex;gap:6px;} .authx-dots i{width:9px;height:9px;border-radius:99px;background:#1b2436;display:block;}
.authx-host{font-family:var(--mono);font-size:.62rem;color:#4a5872;}
.authx-body{padding:2rem 2.2rem;color:#e2e8f0;}
.authx-body h1{font-size:1.3rem;font-weight:700;color:#f1f5f9;margin:0 0 .3rem;}
.authx-body p{color:#94a3b8;font-size:.9rem;margin:0 0 1.2rem;}
.authx-body .field-label{color:#4a5872;}
.authx-body .input,.authx-body .select{background:#0a0f1a;border:1px solid #1b2436;color:#e2e8f0;}
.authx-body .btn.primary{width:100%;justify-content:center;padding:.65rem;background:#2dd4bf;border-color:#2dd4bf;color:#04211c;}
.authx-body .btn.primary:hover{background:#5eead4;border-color:#5eead4;}
.authx-body .btn{background:transparent;border-color:#1b2436;color:#94a3b8;}
.authx-body .btn:hover{border-color:#134e4a;color:#e2e8f0;}
.authx-tag{font-family:var(--mono);font-size:.72rem;color:#33415e;letter-spacing:.04em;}
.auth-mark{display:none;}

/* step indicator */
.authx-steps{display:flex;gap:8px;margin-bottom:1.3rem;}
.authx-steps i{height:3px;flex:1;border-radius:99px;background:#1b2436;display:block;}
.authx-steps i.on{background:#2dd4bf;}

/* trust line */
.authx-trust{margin-top:1rem;font-family:var(--mono);font-size:.68rem;color:#4a5872;display:flex;align-items:center;gap:.4rem;}
.authx-trust .dot{width:6px;height:6px;border-radius:99px;background:#2dd4bf;display:inline-block;}

/* passkey ceremony zone */
.authx-zone{border:1px dashed #1b2436;border-radius:12px;background:#0a0f1a;padding:1.6rem;display:flex;flex-direction:column;align-items:center;gap:.9rem;text-align:center;}
.authx-ring{width:64px;height:64px;border-radius:99px;background:#0f2a26;border:1px solid #134e4a;display:grid;place-items:center;}
.authx-spin{width:28px;height:28px;border-radius:99px;border:3px solid #2dd4bf;border-top-color:transparent;animation:authx-rot .8s linear infinite;}
@keyframes authx-rot{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.authx-spin{animation:none;}}

/* access-ready */
.authx-check{width:36px;height:36px;border-radius:99px;background:#0f2a26;border:1px solid #134e4a;color:#2dd4bf;display:grid;place-items:center;font-size:1.1rem;margin-bottom:.6rem;}
.authx-grants{display:flex;flex-direction:column;gap:.5rem;margin:1rem 0 1.3rem;}
.authx-grant{display:flex;align-items:center;gap:.6rem;border:1px solid #1b2436;border-radius:10px;padding:.55rem .7rem;}
.authx-grant .chip{font-family:var(--mono);font-size:.62rem;color:#94a3b8;background:#1b2436;border-radius:5px;padding:.1rem .4rem;flex:0 0 auto;}
.authx-grant .nm{font-size:.85rem;color:#f1f5f9;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.authx-grant .win{font-family:var(--mono);font-size:.68rem;color:#4a5872;flex:0 0 auto;}
.authx-empty{color:#94a3b8;font-size:.85rem;margin:1rem 0 1.3rem;}
```

Note: the `.auth-actions` / `.auth-or` rules further down stay (LoginForm reuses
them). If `.auth-or` styling isn't present, it's added in Task 3's CSS note.

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles. setup/recover/invite still pass their `<h1>/<p>/form` children
(they render inside `.authx-body`); their `<BrandMark className="auth-mark">` is
hidden by `.auth-mark{display:none}`.

- [ ] **Step 4: Commit**

```bash
git add src/components/auth-shell.tsx src/app/globals.css
git commit -m "feat(auth): dark-centered auth frame (terminal-chrome card + lockup)"
```

---

### Task 3: Rebuild `LoginForm` — 3-state discoverable flow

**Files:**
- Modify: `src/app/login/login-form.tsx` (full rewrite)
- Modify: `src/app/login/page.tsx` (render `<LoginForm>` as the only AuthShell child)
- Modify: `src/app/globals.css` (add `.auth-or` divider if missing)

**Interfaces:**
- Consumes: `GET /api/access/my-grants` (Task 1); the dark frame classes (Task 2); `LocalTime` (`@/app/(app)/_shell/local-time`) for grant windows; `startAuthentication` (`@simplewebauthn/browser`).

- [ ] **Step 1: Rewrite the login form**

Replace `src/app/login/login-form.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { LocalTime } from "@/app/(app)/_shell/local-time";

const GENERIC_ERROR = "No passkey found or verification failed.";

type Grant = { id: string; siteName: string; accessMode: "TRANSPARENT" | "GATEWAY"; endsAt: string | null; scheduled: boolean };
type State = "rest" | "ceremony" | "ready";

export function LoginForm({
  returnTo = "/",
  ssoEnabled = false,
  ssoLabel = "Sign in with SSO",
  ssoError = null,
}: {
  returnTo?: string;
  ssoEnabled?: boolean;
  ssoLabel?: string;
  ssoError?: string | null;
}) {
  const [state, setState] = useState<State>("rest");
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);

  async function signIn() {
    setError(null);
    setState("ceremony");
    try {
      const optionsRes = await fetch("/api/auth/authentication/options", { method: "POST" });
      const options = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) { setError(GENERIC_ERROR); setState("rest"); return; }

      const response = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/authentication/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const result = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !result?.ok) {
        setError(result?.error === "revoked"
          ? "Your access has been revoked — you are no longer a member of an authorized directory group."
          : GENERIC_ERROR);
        setState("rest");
        return;
      }

      // Signed in — fetch active grants for the access-ready step (best-effort).
      try {
        const g = await fetch("/api/access/my-grants");
        const body = (await g.json().catch(() => ({}))) as { grants?: Grant[] };
        setGrants(Array.isArray(body.grants) ? body.grants : []);
      } catch { setGrants([]); }
      setState("ready");
    } catch {
      setError(GENERIC_ERROR);
      setState("rest");
    }
  }

  const seg = (i: number) => (i <= (state === "rest" ? 0 : state === "ceremony" ? 1 : 2) ? "on" : "");

  return (
    <>
      <div className="authx-steps" aria-hidden="true"><i className={seg(0)} /><i className={seg(1)} /><i className={seg(2)} /></div>

      {state === "rest" && (
        <>
          <h1>Sign in</h1>
          <p>Use your device&apos;s passkey — no password.</p>
          {ssoError && <p className="notice error" role="alert">{ssoError}</p>}
          {error && <p className="notice error" role="alert">{error} <a href="/recover">Recover your account</a></p>}
          <div className="auth-actions">
            <button type="button" className="btn primary" onClick={signIn}>Sign in with passkey</button>
            {ssoEnabled && (
              <>
                <div className="auth-or"><span>or</span></div>
                <a className="btn" href={`/api/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`}>{ssoLabel}</a>
              </>
            )}
          </div>
          <div className="authx-trust"><span className="dot" /> MFA enforced · recorded · zero-trust</div>
        </>
      )}

      {state === "ceremony" && (
        <>
          <h1>Verify with passkey</h1>
          <p>Confirm on your device to continue.</p>
          <div className="authx-zone">
            <div className="authx-ring"><div className="authx-spin" /></div>
            <div>Waiting for your passkey…</div>
          </div>
          <div className="auth-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn" onClick={signIn}>Use a different device</button>
          </div>
          <div className="authx-trust"><span className="dot" /> Phishing-resistant WebAuthn</div>
        </>
      )}

      {state === "ready" && (
        <>
          <div className="authx-check" aria-hidden="true">✓</div>
          <h1>You&apos;re in</h1>
          <p>{grants.length > 0 ? "You have access to:" : "You're signed in."}</p>
          {grants.length > 0 ? (
            <div className="authx-grants">
              {grants.map((g) => (
                <div key={g.id} className="authx-grant">
                  <span className="chip">{g.accessMode === "GATEWAY" ? "REMOTE" : "WEB"}</span>
                  <span className="nm">{g.siteName}</span>
                  <span className="win">{g.scheduled ? "scheduled" : g.endsAt ? <LocalTime iso={g.endsAt} /> : "permanent"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="authx-empty">No active grants yet — an admin can grant you access.</div>
          )}
          <div className="auth-actions">
            <a className="btn primary" href={returnTo}>Go to my access</a>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Render LoginForm as the sole AuthShell child**

In `src/app/login/page.tsx`, replace the AuthShell body (the `<BrandMark…/>`,
`<h1>Sign in</h1>`, `<p>…</p>`, `<LoginForm…/>`) with just the form — it now owns
the heading/steps:

```tsx
  return (
    <AuthShell>
      <LoginForm returnTo={returnTo} ssoEnabled={ssoEnabled} ssoLabel={ssoLabel} ssoError={errorMsg} />
    </AuthShell>
  );
```

Remove the now-unused `import { BrandMark } from "@/components/brand";` from
`login/page.tsx` if nothing else uses it.

- [ ] **Step 3: Ensure the `.auth-or` divider styles exist (dark)**

In `src/app/globals.css`, near the `.auth-actions` rule, add (if not already
present) a dark divider:

```css
.auth-or{display:flex;align-items:center;gap:.6rem;color:#4a5872;font-size:.75rem;}
.auth-or::before,.auth-or::after{content:"";height:1px;flex:1;background:#1b2436;}
```

- [ ] **Step 4: Verify it builds**

Run: `pnpm build`
Expected: Compiles; `/login` renders.

- [ ] **Step 5: Commit**

```bash
git add "src/app/login/login-form.tsx" "src/app/login/page.tsx" src/app/globals.css
git commit -m "feat(auth): 3-state discoverable login (rest → ceremony → access-ready)"
```

---

### Task 4: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (unchanged count; no new tests — presentational + a route, consistent with the repo).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles; `/api/access/my-grants` + `/login` present.
- [ ] **Step 3: Manual (Gate A, after deploy):**
  1. `/login` shows the dark centered card (terminal bar, lockup above, tagline below), step-1 active.
  2. "Sign in with passkey" → the passkey prompt; while waiting, the ceremony spinner + "Waiting for your passkey…" show (step 2).
  3. On success → access-ready: ✓ "You're in" + active-grants list (REMOTE/WEB chip, name, window) + "Go to my access" → lands at `returnTo` (vendor→/access, admin→console).
  4. Cancel/wrong passkey → back to step 1 with the error + "Recover your account".
  5. With SSO configured → "Continue with <provider>" still does a full-page redirect.
  6. `/setup`, `/recover`, `/invite/<token>` all render inside the same dark centered card (no step indicator).
  7. Toggle the app light/dark theme — the auth screens stay dark (fixed frame) and legible.

---

## Notes for the implementer

- Do **not** add an email/identifier field — discoverable one-tap is intentional.
- The auth frame is fixed-dark by design (hardcoded hex, not theme tokens); that is correct, not a theme bug.
- `my-grants` is best-effort for step 3 — if it fails, still show "You're in" + "Go to my access" (never block sign-in on it).
- Deploy: **v0.52.0, manager-only** — bump the manager tag, `docker compose up -d access-manager`, verify `/login` 200, then Gate A.
- `classifyGrant` consumes the exact object `listUserGrants` returns (it selects startsAt/endsAt/status/requiresApproval/approvedAt/schedule) — no extra fields needed.
```
