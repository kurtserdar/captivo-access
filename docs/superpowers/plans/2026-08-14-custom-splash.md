# Custom Connect Splash (global white-label) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deployment admin upload a custom splash image (static PNG/JPG/WebP or animated GIF) shown in place of the Captivo brand mark on the session connecting screen; unset → the default Captivo splash.

**Architecture:** A global single-row `BrandingConfig` stores the uploaded image (Bytes). A serving route returns it; the `ConnectSplash` renders it via `<img>` and falls back to `BrandLockup` on error. Manager-only + additive schema. The rest of the splash (navy layout, "Creating a secure connection…", spinner) is unchanged.

**Tech Stack:** Next.js/TypeScript, Prisma.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Global (deployment-wide), not per-site. Swap only the brand image — keep the splash layout + connecting text + spinner.
- Additive schema → `prisma db push` (no `--accept-data-loss`).
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Schema — `BrandingConfig`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

Add near the other single-row config models (e.g. after `SmtpConfig`):

```prisma
model BrandingConfig {
  id              String   @id
  splashImage     Bytes?
  splashImageType String? // MIME of splashImage
  updatedAt       DateTime @updatedAt
}
```

- [ ] **Step 2: Regenerate + commit**

Run: `pnpm db:generate`
Expected: success.

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add BrandingConfig for a custom splash image"
```

---

### Task 2: Upload validation lib

**Files:**
- Create: `src/lib/branding/splash.ts`

**Interfaces:**
- Produces: `parseSplashUpload(image, type): SplashUpdate`, `ALLOWED_SPLASH_TYPES`, `MAX_SPLASH_BYTES`.

- [ ] **Step 1: Write it (mirrors `parseLogoUpload`, adds GIF, 2 MB cap)**

Create `src/lib/branding/splash.ts`:

```ts
// Pure validation for an uploaded splash image. Arrives as base64 (or a data: URL)
// plus a MIME type; decodes + bounds it. Rendered only via <img> under a sandboxing
// CSP, so raster + GIF are safe. No SVG (avoid scriptable markup for a full-viewport
// image).
export const ALLOWED_SPLASH_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_SPLASH_BYTES = 2 * 1024 * 1024; // 2 MB (GIFs run larger)

export type SplashUpdate =
  | { action: "clear" }
  | { action: "set"; data: Uint8Array<ArrayBuffer>; type: string }
  | { action: "error"; error: string };

export function parseSplashUpload(image: unknown, type: unknown): SplashUpdate {
  if (image === null || image === "") return { action: "clear" };
  if (typeof image !== "string") return { action: "error", error: "invalid_image" };
  if (typeof type !== "string" || !ALLOWED_SPLASH_TYPES.has(type)) {
    return { action: "error", error: "invalid_image_type" };
  }
  const comma = image.indexOf(",");
  const b64 = image.startsWith("data:") && comma >= 0 ? image.slice(comma + 1) : image;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) return { action: "error", error: "invalid_image" };
  if (buf.length > MAX_SPLASH_BYTES) return { action: "error", error: "image_too_large" };
  const data = new Uint8Array(buf.length);
  data.set(buf);
  return { action: "set", data, type };
}
```

- [ ] **Step 2: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add src/lib/branding/splash.ts
git commit -m "feat(branding): splash upload validation"
```

---

### Task 3: Serving + manage routes

**Files:**
- Create: `src/app/api/branding/splash/route.ts` (GET — serve)
- Create: `src/app/api/admin/branding/splash/route.ts` (POST/DELETE — manage)

**Interfaces:**
- `GET /api/branding/splash` → image bytes (200) or 404 (any authenticated user).
- `POST /api/admin/branding/splash` `{ splashImage, splashImageType }` (admin) → upsert.
- `DELETE /api/admin/branding/splash` (admin) → clear.

- [ ] **Step 1: Serving route**

Create `src/app/api/branding/splash/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the custom splash image to any authenticated user (branding, not sensitive).
// no-store so a re-upload shows immediately. Sandboxing CSP + nosniff neutralise any
// mistyped payload.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await db.brandingConfig.findUnique({ where: { id: "singleton" }, select: { splashImage: true, splashImageType: true } });
  if (!b?.splashImage || !b.splashImageType) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(b.splashImage), {
    status: 200,
    headers: {
      "Content-Type": b.splashImageType,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Manage route**

Create `src/app/api/admin/branding/splash/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseSplashUpload } from "@/lib/branding/splash";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = "singleton";

export async function POST(req: Request) {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { splashImage?: unknown; splashImageType?: unknown };
  const parsed = parseSplashUpload(body.splashImage, body.splashImageType);
  if (parsed.action === "error") return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.action === "clear") {
    await db.brandingConfig.upsert({ where: { id: ID }, create: { id: ID }, update: { splashImage: null, splashImageType: null } });
  } else {
    await db.brandingConfig.upsert({
      where: { id: ID },
      create: { id: ID, splashImage: parsed.data, splashImageType: parsed.type },
      update: { splashImage: parsed.data, splashImageType: parsed.type },
    });
  }
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "branding.update",
    targetType: "branding", targetId: "splash",
    summary: parsed.action === "clear" ? "Removed the custom splash image" : "Updated the custom splash image",
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.brandingConfig.upsert({ where: { id: ID }, create: { id: ID }, update: { splashImage: null, splashImageType: null } });
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "branding.update",
    targetType: "branding", targetId: "splash",
    summary: "Removed the custom splash image",
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/api/branding/splash/route.ts" "src/app/api/admin/branding/splash/route.ts"
git commit -m "feat(branding): serve + manage the custom splash image"
```

---

### Task 4: Admin page + nav entry

**Files:**
- Create: `src/app/(app)/admin/branding/page.tsx`
- Create: `src/app/(app)/admin/branding/splash-form.tsx`
- Modify: `src/lib/nav/model.ts`
- Modify: `src/app/(app)/_shell/nav-icons.tsx`

- [ ] **Step 1: Upload form (client)**

Create `src/app/(app)/admin/branding/splash-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SplashForm({ hasSplash }: { hasSplash: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("The image must be 2 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => { setPreview(String(reader.result)); setType(file.type); };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/branding/splash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ splashImage: preview, splashImageType: type }) });
      if (res.ok) { setPreview(null); router.refresh(); }
      else { setError("Upload failed. Use a PNG/JPG/WebP/GIF under 2 MB."); }
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/branding/splash", { method: "DELETE" });
      if (res.ok) { setPreview(null); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="field" style={{ maxWidth: 460 }}>
      <div style={{ background: "#0b1220", borderRadius: 10, padding: 24, display: "flex", justifyContent: "center", minHeight: 120, alignItems: "center", marginBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview ?? (hasSplash ? "/api/branding/splash" : "")} alt="" style={{ maxHeight: 96, maxWidth: 300 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick} />
      {error && <p className="notice warn" role="alert" style={{ marginTop: 8 }}>{error}</p>}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy || !preview} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        {hasSplash && <button type="button" className="btn" disabled={busy} onClick={remove}>Remove</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Page (server)**

Create `src/app/(app)/admin/branding/page.tsx`:

```tsx
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SplashForm } from "./splash-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branding" };

export default async function BrandingPage() {
  const user = await requireUser();
  if (!can(user.role, "configure")) notFound();
  const b = await db.brandingConfig.findUnique({ where: { id: "singleton" }, select: { splashImageType: true } });
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Branding</h1>
          <p>Customize how Captivo Access looks to your vendors.</p>
        </div>
      </div>
      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Connecting screen</h2>
        <p className="cell-sub" style={{ marginBottom: 12 }}>The image shown on the connecting screen while a remote-desktop or isolated-browser session starts. PNG, JPG, WebP, or animated GIF, up to 2 MB. Leave empty to show the default Captivo mark.</p>
        <SplashForm hasSplash={!!b?.splashImageType} />
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Nav entry + icon**

In `src/app/(app)/_shell/nav-icons.tsx`, add a `branding` `NavIconKey` mapped to a simple SVG glyph (e.g. an image/photo outline), following the existing icons' shape.

In `src/lib/nav/model.ts`, add to the Infrastructure settings column (next to `Policy`/`Email`):

```ts
        { label: "Branding", href: "/admin/branding", icon: "branding", desc: "Your logo on the connecting screen" },
```

- [ ] **Step 4: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/(app)/admin/branding/page.tsx" "src/app/(app)/admin/branding/splash-form.tsx" src/lib/nav/model.ts "src/app/(app)/_shell/nav-icons.tsx"
git commit -m "feat(admin): branding page to upload the custom splash image"
```

---

### Task 5: ConnectSplash renders the custom image

**Files:**
- Modify: `src/app/gateway/[siteId]/session/connect-splash.tsx`

- [ ] **Step 1: Try the custom image, fall back to BrandLockup**

Replace `src/app/gateway/[siteId]/session/connect-splash.tsx`:

```tsx
"use client";
import { useState } from "react";
import { BrandLockup } from "@/components/brand";

// Full-viewport branded overlay shown while a session connects. Shows the deployment's
// custom splash image if one is uploaded (/api/branding/splash), else the default
// Captivo BrandLockup. Fixed dark navy palette + verified-teal accent ring; the
// connecting text + spinner are unchanged.
export function ConnectSplash({ siteName }: { siteName: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="connect-splash" role="status" aria-live="polite">
      <div className="connect-splash-ring" aria-hidden="true" />
      <div className="connect-splash-body">
        {imgFailed ? (
          <BrandLockup size={40} className="connect-splash-brand" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/branding/splash" alt="" className="connect-splash-brand" style={{ maxHeight: 96, maxWidth: 300 }} onError={() => setImgFailed(true)} />
        )}
        <div className="connect-splash-site">{siteName}</div>
        <div className="connect-splash-note">Creating a secure connection…</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/gateway/[siteId]/session/connect-splash.tsx"
git commit -m "feat(session): show the custom splash image on the connecting screen"
```

---

### Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Build green**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 2: Wiring grep**

Run: `grep -rn "brandingConfig" src/app/api && grep -rn "/api/branding/splash" "src/app/gateway/[siteId]/session/connect-splash.tsx" && grep -rn "/admin/branding" src/lib/nav/model.ts`
Expected: matches in each.

- [ ] **Step 3: Manual Gate (record for deploy gate)**

Deferred to deploy (`db push` for BrandingConfig):
- No custom splash → connecting screen shows the Captivo mark (today's behaviour).
- Upload an image (static + GIF) under /admin/branding → an isolated/gateway session's connecting screen shows it; removing it → back to the Captivo mark.
- Non-admins can't reach /admin/branding; the upload rejects >2 MB / non-image.

---

## Self-Review

**Spec coverage:**
- `BrandingConfig` single-row schema (additive) → Task 1. ✓
- Splash upload validation (png/jpg/webp/gif, 2 MB) → Task 2. ✓
- Serve (auth, no-store) + manage (admin POST/DELETE, audited) routes → Task 3. ✓
- Admin branding page + upload form + nav entry → Task 4. ✓
- ConnectSplash shows custom image, falls back to BrandLockup (layout/text/spinner kept) → Task 5. ✓
- Global; swap brand image only; static + GIF → per design. ✓

**Placeholder scan:** none — concrete code; Task 4 Step 3 names the icon + nav additions to make.

**Type/name consistency:** `parseSplashUpload` + `SplashUpdate` defined (Task 2) + used in the manage route (Task 3). `brandingConfig` model + fixed id `"singleton"` used consistently across serve/manage/page. `/api/branding/splash` referenced by the serve route (Task 3), the form preview + ConnectSplash (Tasks 4–5). `branding` NavIconKey added (Task 4) matches the nav item's `icon`.
