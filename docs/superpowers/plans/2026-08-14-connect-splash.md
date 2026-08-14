# Branded Connect Splash + Isolated-desktop Background Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a branded, auto-dismissing "connecting…" splash at the start of every GATEWAY and ISOLATED session, and stop the isolated-browser container from popping an `fbsetbg` wallpaper-error dialog.

**Architecture:** Two independent pieces. (1) In the kasm image, install `hsetroot` and paint a solid black background after fluxbox starts so `fbsetbg` finds a setter. (2) In the manager, a presentational `ConnectSplash` overlay (console navy/teal) is mounted above the session viewer and unmounted by the parent when the session signals ready — guac `STATE_CONNECTED` for GATEWAY, iframe `onLoad` for ISOLATED, with a 20 s fallback. ISOLATED is routed through the existing consent gate for the first time.

**Tech Stack:** Next.js (React client components), TypeScript, guacamole-common-js, KasmVNC, Python broker (`control.py`), Debian image (`hsetroot`).

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Do not break the native GATEWAY (RDP/SSH/VNC) guac path, the ISOLATED KasmVNC path, or the transparent browserproxy.
- No new white-label / platform-logo config: splash uses `BrandLockup` + `Site.name`.
- No wallpaper image painted into any session; isolated desktop background is plain black only.
- Verification is `pnpm build` (typecheck) + manual Gate after deploy. This repo has no React Testing Library, so UI tasks have no unit tests; do not scaffold a test runner.
- Deploy + release note are a separate gate needing explicit user approval — do not auto-run.

---

### Task 1: Isolated-desktop background cleanup (kasm image)

Kill the `fbsetbg` error dialog by installing a wallpaper-setter and painting a solid black background per session. Self-contained; ships in the kasm image build. No dependency on later tasks.

**Files:**
- Modify: `kasm-browser/Dockerfile` (apt install line, ~line 3-9)
- Modify: `kasm-browser/control.py` `_spawn(...)` (~line 52-63)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks (independent).

- [ ] **Step 1: Add `hsetroot` to the image**

In `kasm-browser/Dockerfile`, add `hsetroot` to the `apt-get install -y --no-install-recommends` package list (the line that currently begins `curl ca-certificates chromium fluxbox python3 dumb-init ffmpeg`). Result:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates chromium fluxbox python3 dumb-init ffmpeg hsetroot \
      libxfont2 libxtst6 libgl1 libgbm1 libxcb-render0 libxcb-shm0 \
```

- [ ] **Step 2: Paint a solid background after fluxbox starts**

In `kasm-browser/control.py`, inside `_spawn(...)`, between the `fbox = subprocess.Popen(["fluxbox"], ...)` line and the `chrome = subprocess.Popen(...)` line, add a fire-and-forget `hsetroot` call on the same display. `fbsetbg` (run by fluxbox on startup) now finds `hsetroot` and no error dialog appears; the background stays plain black:

```python
    fbox = subprocess.Popen(["fluxbox"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Paint a plain solid background so fluxbox's fbsetbg helper finds a wallpaper
    # setter and stops raising its "I can't find an app to set the wallpaper with"
    # X dialog (briefly visible in the canvas before Chromium kiosk covers it). No
    # brand image here — the app-side ConnectSplash carries the branding.
    subprocess.Popen(["hsetroot", "-solid", "#000000"], env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    chrome = subprocess.Popen(
```

- [ ] **Step 3: Verify Python parses**

Run: `python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add kasm-browser/Dockerfile kasm-browser/control.py
git commit -m "fix(isolated): paint solid desktop background to silence fbsetbg dialog"
```

---

### Task 2: `ConnectSplash` component + CSS

A presentational, always-visible-while-mounted overlay. Holds no dismiss logic; parents mount/unmount it. New file compiles as an unused export until Tasks 3–4 reference it — build stays green.

**Files:**
- Create: `src/app/gateway/[siteId]/session/connect-splash.tsx`
- Modify: `src/app/globals.css` (append splash styles)

**Interfaces:**
- Consumes: `BrandLockup` from `@/components/brand`.
- Produces: `ConnectSplash({ siteName }: { siteName: string })` — default export is NOT used; named export `ConnectSplash`.

- [ ] **Step 1: Write the component**

Create `src/app/gateway/[siteId]/session/connect-splash.tsx`:

```tsx
"use client";
import { BrandLockup } from "@/components/brand";

// Full-viewport branded overlay shown while a session connects. Purely
// presentational: it is visible for as long as it is mounted, and the parent
// (GatewaySession / IsolatedSession) decides when the session is ready and stops
// rendering it. Fixed dark navy palette (the session route lives outside the app
// shell/theme, over a black viewer), verified-teal accent ring.
export function ConnectSplash({ siteName }: { siteName: string }) {
  return (
    <div className="connect-splash" role="status" aria-live="polite">
      <div className="connect-splash-ring" aria-hidden="true" />
      <div className="connect-splash-body">
        <BrandLockup size={40} className="connect-splash-brand" />
        <div className="connect-splash-site">{siteName}</div>
        <div className="connect-splash-note">Creating a secure connection…</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS**

Append to `src/app/globals.css`:

```css
/* Branded connect splash (session route, theme-independent dark navy) */
.connect-splash {
  position: fixed; inset: 0; z-index: 50;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5rem;
  background: #0b1220; color: #e8edf5;
  font-family: var(--font-sans, system-ui, sans-serif);
}
.connect-splash-ring {
  position: absolute; width: 260px; height: 260px; border-radius: 50%;
  border: 3px solid rgba(25, 194, 187, 0.18);
  border-top-color: #19c2bb; border-right-color: #19c2bb;
  animation: connect-splash-spin 1.1s linear infinite;
}
.connect-splash-body { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; text-align: center; }
.connect-splash-brand { transform: scale(1.05); }
.connect-splash-site { margin-top: 0.75rem; font-size: 1.15rem; font-weight: 600; color: #e8edf5; }
.connect-splash-note { font-size: 0.9rem; color: #8ea0ba; }
@keyframes connect-splash-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .connect-splash-ring { animation: none; border-color: rgba(25, 194, 187, 0.35); border-top-color: #19c2bb; }
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: build succeeds (new component + CSS compile; component is unused for now, which is fine).

- [ ] **Step 4: Commit**

```bash
git add "src/app/gateway/[siteId]/session/connect-splash.tsx" src/app/globals.css
git commit -m "feat(session): add branded ConnectSplash overlay component"
```

---

### Task 3: `IsolatedSession` wrapper (iframe + splash)

Move the KasmVNC iframe out of the server page into a client component that overlays `ConnectSplash` and dismisses it on iframe `onLoad` (min 600 ms) with a 20 s fallback. New file; referenced by Task 4. Compiles as an unused export until then — build stays green.

**Files:**
- Create: `src/app/gateway/[siteId]/session/isolated-client.tsx`

**Interfaces:**
- Consumes: `ConnectSplash` from `./connect-splash` (Task 2).
- Produces: `IsolatedSession({ siteId, siteName }: { siteId: string; siteName: string })` — named export.

- [ ] **Step 1: Write the component**

Create `src/app/gateway/[siteId]/session/isolated-client.tsx`. The iframe markup, `kasmParams`, `src`, style, and `allow` are copied verbatim from the current `page.tsx` ISOLATED branch:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { ConnectSplash } from "./connect-splash";

// ?site pins the session for the data-plane; it sets a cookie so the KasmVNC
// client's follow-up asset/WS requests (which carry no ?site) inherit it.
// path= keeps the client's RFB WebSocket under /kasm-tunnel/ (its default absolute
// /websockify would route to the manager, not the data-plane). clipboard_* turn ON
// the client's seamless clipboard (OFF by default); per-direction policy is still
// enforced server-side by the broker's DLP config.
const KASM_PARAMS = "path=kasm-tunnel/websockify&clipboard_seamless=true&clipboard_up=true&clipboard_down=true";

export function IsolatedSession({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [ready, setReady] = useState(false);
  const mounted = useRef(0);

  useEffect(() => {
    mounted.current = Date.now();
    // Fallback: never leave the vendor stuck behind the splash if the browser
    // never fires onLoad — reveal the real canvas/error after 20 s.
    const t = setTimeout(() => setReady(true), 20000);
    return () => clearTimeout(t);
  }, []);

  // Keep the splash up for at least 600 ms so a fast load does not flash it.
  const onLoad = () => {
    const wait = Math.max(0, 600 - (Date.now() - mounted.current));
    setTimeout(() => setReady(true), wait);
  };

  return (
    <>
      <iframe
        title="Isolated browser"
        src={`/kasm-tunnel/?site=${siteId}&${KASM_PARAMS}`}
        onLoad={onLoad}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
        allow="clipboard-read; clipboard-write"
      />
      {!ready && <ConnectSplash siteName={siteName} />}
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: build succeeds (unused export is fine).

- [ ] **Step 3: Commit**

```bash
git add "src/app/gateway/[siteId]/session/isolated-client.tsx"
git commit -m "feat(session): add IsolatedSession wrapper with connect splash"
```

---

### Task 4: Integration — GatewaySession ready state, mode-aware ConsentGate, page routing

Land all prop-signature changes together so the build stays green: `GatewaySession` gains `siteName` + ready-state + splash; `ConsentGate` becomes mode-aware; `page.tsx` selects `name`, drops the early ISOLATED return, and routes both modes through consent.

**Files:**
- Modify: `src/app/gateway/[siteId]/session/session-client.tsx`
- Modify: `src/app/gateway/[siteId]/session/consent-gate.tsx`
- Modify: `src/app/gateway/[siteId]/session/page.tsx`

**Interfaces:**
- Consumes: `ConnectSplash` (Task 2), `IsolatedSession` (Task 3).
- Produces: `GatewaySession({ siteId, siteName, recorded, clipboardMode })`; `ConsentGate({ accessMode, siteId, siteName, recorded, clipboardMode })`.

- [ ] **Step 1: GatewaySession — add `siteName` prop, ready state, splash, state hook**

In `src/app/gateway/[siteId]/session/session-client.tsx`:

(a) Change the signature and add the import at the top of the file (after the existing imports):

```tsx
import { ConnectSplash } from "./connect-splash";
```

```tsx
export function GatewaySession({ siteId, siteName, recorded, clipboardMode }: { siteId: string; siteName: string; recorded: boolean; clipboardMode: string }) {
```

(b) Add ready state next to the existing `const [error, setError] = useState<string | null>(null);`:

```tsx
  const [ready, setReady] = useState(false);
```

(c) In the guac setup, right after `client.onerror = fail;` (~line 133), add the connected-state hook:

```tsx
      // Dismiss the connect splash once guacd reaches CONNECTED (state 3).
      client.onstatechange = (state: number) => { if (state === 3 && !disposed) setReady(true); };
```

(d) In the same connect effect, immediately after the `let disposed = false;` (or equivalent guard at the top of the effect), add the fallback timer, and clear it in the effect's cleanup `return () => { ... }`:

```tsx
      const readyTimer = window.setTimeout(() => setReady(true), 20000);
```

Add to the cleanup function:

```tsx
        window.clearTimeout(readyTimer);
```

(e) Render the splash inside the root `<div style={{ position: "fixed", inset: 0, background: "#000", ... }}>` — add as the first child, before the `<div ref={ref} ...>`:

```tsx
      {!ready && !error && <ConnectSplash siteName={siteName} />}
```

- [ ] **Step 2: ConsentGate — make it mode-aware**

Replace `src/app/gateway/[siteId]/session/consent-gate.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { GatewaySession } from "./session-client";
import { IsolatedSession } from "./isolated-client";

export function ConsentGate({ accessMode, siteId, siteName, recorded, clipboardMode }: { accessMode: "GATEWAY" | "ISOLATED"; siteId: string; siteName: string; recorded: boolean; clipboardMode: string }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await fetch(`/api/gateway/${siteId}/consent`, { method: "POST" });
    } catch {
      /* audit is best-effort; proceed regardless */
    }
    setAccepted(true);
  }

  if (accepted) {
    return accessMode === "ISOLATED"
      ? <IsolatedSession siteId={siteId} siteName={siteName} />
      : <GatewaySession siteId={siteId} siteName={siteName} recorded={recorded} clipboardMode={clipboardMode} />;
  }

  return (
    <div className="consent-gate">
      <div className="consent-card">
        <h1>This session is recorded</h1>
        <p>
          For security and compliance, your activity in this remote session is
          recorded. Continue only if you consent to being recorded.
        </p>
        <button type="button" className="btn primary" disabled={busy} onClick={accept}>
          {busy ? "Starting…" : "I understand — connect"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: page.tsx — select name, drop early ISOLATED return, route both modes**

In `src/app/gateway/[siteId]/session/page.tsx`:

(a) Add the `IsolatedSession` import next to the other imports:

```tsx
import { IsolatedSession } from "./isolated-client";
```

(b) Add `name: true` to the `select` in `db.site.findUnique`:

```tsx
  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true, name: true, recordSessions: true, clipboardMode: true } });
```

(c) Delete the entire early ISOLATED block (`if (site.accessMode === "ISOLATED") { ... return <iframe .../>; }`, including the `kasmParams` line and its comments). The iframe now lives in `IsolatedSession`.

(d) Replace the final `return consentNeeded ? <ConsentGate .../> : <GatewaySession .../>;` with routing that covers both modes:

```tsx
  if (consentNeeded) {
    return <ConsentGate accessMode={site.accessMode} siteId={siteId} siteName={site.name} recorded={recorded} clipboardMode={site.clipboardMode} />;
  }
  return site.accessMode === "ISOLATED"
    ? <IsolatedSession siteId={siteId} siteName={site.name} />
    : <GatewaySession siteId={siteId} siteName={site.name} recorded={recorded} clipboardMode={site.clipboardMode} />;
```

Keep the existing `okGateway`/`okIsolated` guards, the `notFound()` call, `recorded = recordingEnabled() && site.recordSessions`, the `alreadyConsented` cookie read, and `consentNeeded` computation unchanged. (These already sit above the old ISOLATED return; after deleting that block they apply to both modes.)

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds. No `siteName`-missing type errors (all three call sites — page direct GATEWAY, page direct ISOLATED, ConsentGate — now pass it).

- [ ] **Step 5: Commit**

```bash
git add "src/app/gateway/[siteId]/session/session-client.tsx" "src/app/gateway/[siteId]/session/consent-gate.tsx" "src/app/gateway/[siteId]/session/page.tsx"
git commit -m "feat(session): branded connect splash for gateway + isolated, route isolated through consent"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Manager build green**

Run: `pnpm build`
Expected: success.

- [ ] **Step 2: Data-plane unaffected**

Run: `cd dataplane && go build ./... && cd ..`
Expected: success (no dataplane source changed; sanity check).

- [ ] **Step 3: Residue / correctness grep**

Run: `grep -rn "kasmParams\|<iframe" "src/app/gateway/[siteId]/session/page.tsx"`
Expected: no matches (the iframe + kasmParams moved entirely into `isolated-client.tsx`).

Run: `grep -rn "siteName" "src/app/gateway/[siteId]/session/"`
Expected: matches in `page.tsx`, `consent-gate.tsx`, `session-client.tsx`, `isolated-client.tsx`, `connect-splash.tsx` — every session component threads it.

- [ ] **Step 4: Manual Gate checklist (record for the deploy gate)**

Deferred to deploy (separate approval). After deploy, verify:
- ISOLATED: branded splash shows then disappears when the browser loads; no `fbsetbg` dialog in the canvas.
- GATEWAY (RDP): splash shows until the desktop appears, then disappears.
- Recorded + consent-required resource: consent card → splash → session, for BOTH GATEWAY and ISOLATED.
- Guac failure still shows the error screen (splash not stuck).

---

## Self-Review

**Spec coverage:**
- Piece 1 (fbsetbg cleanup) → Task 1. ✓
- ConnectSplash component + CSS → Task 2. ✓
- GATEWAY ready via STATE_CONNECTED (3) + 20 s fallback → Task 4 Step 1. ✓
- ISOLATED ready via iframe onLoad (≥600 ms) + 20 s fallback → Task 3. ✓
- Consent ordering + ISOLATED consent-gap closed → Task 4 Steps 2–3. ✓
- Console navy/teal, no photo bg, prefers-reduced-motion → Task 2. ✓
- Site name on splash → Tasks 2/3/4 thread `siteName`; page selects `name`. ✓
- Web App out of scope → not touched. ✓

**Placeholder scan:** none — all steps carry concrete code.

**Type consistency:** `ConnectSplash({ siteName })`, `IsolatedSession({ siteId, siteName })`, `GatewaySession({ siteId, siteName, recorded, clipboardMode })`, `ConsentGate({ accessMode, siteId, siteName, recorded, clipboardMode })` — names/props consistent across Tasks 2–4. Guac connected state `3` used consistently. `accessMode` union `"GATEWAY" | "ISOLATED"` matches the page guard.
