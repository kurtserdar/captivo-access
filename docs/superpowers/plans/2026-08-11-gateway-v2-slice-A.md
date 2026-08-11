# Gateway v2 — Slice A (native remote-desktop site model + form) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure a remote-desktop (RDP/SSH/VNC) site natively in one form — protocol/host/port/credential — with no Guacamole, no public hostname.

**Architecture:** Add a type selector to the site form (Web app vs Remote desktop). A pure `validateSiteInput` helper branches per type; the create/update routes write a remote-desktop site + its `VaultCredential` in one transaction, with `hostname`/`upstreamUrl` null. The separate "Vault credential" section is removed (merged into the form). Manager + database only.

**Tech Stack:** Next.js (App Router), Prisma 7 (`db push`), Vitest.

## Global Constraints

- **English only** in code/comments/commits/UI; **no Claude signature** in commits.
- **Prisma `db push`** (never migrate); `pnpm db:generate` unlocks build/tests; the real DB is applied at deploy by the versioned `migrate` one-shot (**bump manager + migrate together, run `docker compose run --rm access-migrate`**).
- **Two types via the existing `accessMode` enum** (`TRANSPARENT` = Web app, `GATEWAY` = Remote desktop), relabeled in the UI.
- **`hostname` is optional** — required for web apps, `null` for remote-desktop sites.
- **Remote-desktop target lives in `VaultCredential`** (protocol/targetHost/targetPort/username/secret/secretKind, encrypted via `@/lib/crypto` `encrypt()`), 1:1 with the site. The secret field is write-only; never returned to a client.
- **Remote desktop is gated by `nativeGatewayEnabled()`** — the type isn't offered / a direct POST is rejected when off.
- **Recording toggle is NOT in this slice** (Slice C). Gateway sites keep `recordSessions=false` here.
- **A remote-desktop site and its credential are always written together** (one Prisma `$transaction`).
- **Manager only** — no data-plane/connector changes.

---

## File Structure

- `prisma/schema.prisma` — `Site.hostname` → `String?`.
- `src/lib/site/validate.ts` (new) — `validateSiteInput` (pure, per-type).
- `src/lib/site/validate.test.ts` (new) — unit tests.
- `src/lib/vault/store.ts` — add `getVaultCredentialMeta(siteId)` (non-secret fields + hasSecret, for seeding the form).
- `src/app/api/admin/sites/route.ts` — create: use validator; gateway → site+vault transaction.
- `src/app/api/admin/sites/[id]/route.ts` — update: same.
- `src/app/(app)/admin/sites/site-form.tsx` — type selector + branched fields.
- `src/app/(app)/admin/sites/[id]/edit/page.tsx` — remove the standalone `VaultCredentialForm`; seed the form's remote-desktop fields from the vault; pass `nativeGateway`.
- `src/app/(app)/admin/sites/add-site-button.tsx` / `sites-view.tsx` — thread `nativeGateway` into the add form.

---

### Task 1: Schema (hostname nullable) + `validateSiteInput` helper

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/site/validate.ts`
- Create: `src/lib/site/validate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type SiteValidation =
    | { ok: true; mode: "TRANSPARENT"; connectorId: string; name: string; hostname: string; upstreamUrl: string; description: string | null; insecureSkipVerify: boolean; clipboardMode: string; recordSessions: boolean }
    | { ok: true; mode: "GATEWAY"; connectorId: string; name: string; description: string | null; protocol: "RDP" | "SSH" | "VNC"; targetHost: string; targetPort: number; username: string; secret: string | null }
    | { ok: false; error: string };
  function validateSiteInput(body: Record<string, unknown>, opts: { nativeGateway: boolean; requireSecret: boolean; recordingEnabled: boolean }): SiteValidation;
  ```

- [ ] **Step 1: Make `hostname` nullable.** In `prisma/schema.prisma`, change `hostname String @unique` to `hostname String? @unique`. Then `pnpm db:generate`.

- [ ] **Step 2: Write the failing test.** In `src/lib/site/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateSiteInput } from "./validate";

const base = { nativeGateway: true, requireSecret: true, recordingEnabled: true };

describe("validateSiteInput", () => {
  it("web app needs hostname + upstream", () => {
    const r = validateSiteInput({ accessMode: "TRANSPARENT", connectorId: "c", name: "n", hostname: "", upstreamUrl: "" }, base);
    expect(r).toMatchObject({ ok: false });
  });
  it("web app ok returns normalized fields", () => {
    const r = validateSiteInput({ accessMode: "TRANSPARENT", connectorId: "c", name: "n", hostname: "APP.x.io", upstreamUrl: "http://10.0.0.5:80", recordSessions: true }, base);
    expect(r).toMatchObject({ ok: true, mode: "TRANSPARENT", hostname: "app.x.io", recordSessions: true });
  });
  it("web app rejects a non-http upstream", () => {
    const r = validateSiteInput({ accessMode: "TRANSPARENT", connectorId: "c", name: "n", hostname: "a.x", upstreamUrl: "ftp://x" }, base);
    expect(r).toMatchObject({ ok: false, error: "invalid_upstream_url" });
  });
  it("remote desktop needs protocol/host/port/username/secret", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "RDP", targetHost: "", targetPort: 0, username: "", secret: "" }, base);
    expect(r).toMatchObject({ ok: false });
  });
  it("remote desktop ok returns the target", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "rdp", targetHost: "10.0.0.5", targetPort: 3389, username: "adm", secret: "pw" }, base);
    expect(r).toMatchObject({ ok: true, mode: "GATEWAY", protocol: "RDP", targetHost: "10.0.0.5", targetPort: 3389, username: "adm", secret: "pw" });
  });
  it("remote desktop rejected when native gateway is off", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "RDP", targetHost: "h", targetPort: 3389, username: "u", secret: "s" }, { ...base, nativeGateway: false });
    expect(r).toMatchObject({ ok: false, error: "native_gateway_disabled" });
  });
  it("remote desktop update may omit the secret (requireSecret false)", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "SSH", targetHost: "h", targetPort: 22, username: "u", secret: "" }, { ...base, requireSecret: false });
    expect(r).toMatchObject({ ok: true, secret: null });
  });
});
```

- [ ] **Step 3: Run to fail.** `pnpm test src/lib/site/validate.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `src/lib/site/validate.ts`.**

```ts
const CLIP = ["allow", "no_copy", "no_paste", "none"];
const PROTOCOLS = ["RDP", "SSH", "VNC"] as const;

export type SiteValidation =
  | { ok: true; mode: "TRANSPARENT"; connectorId: string; name: string; hostname: string; upstreamUrl: string; description: string | null; insecureSkipVerify: boolean; clipboardMode: string; recordSessions: boolean }
  | { ok: true; mode: "GATEWAY"; connectorId: string; name: string; description: string | null; protocol: "RDP" | "SSH" | "VNC"; targetHost: string; targetPort: number; username: string; secret: string | null }
  | { ok: false; error: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function validateSiteInput(
  body: Record<string, unknown>,
  opts: { nativeGateway: boolean; requireSecret: boolean; recordingEnabled: boolean },
): SiteValidation {
  const connectorId = str(body.connectorId);
  const name = str(body.name);
  const description = str(body.description) || null;
  const mode = body.accessMode === "GATEWAY" ? "GATEWAY" : "TRANSPARENT";
  if (!connectorId || !name) return { ok: false, error: "connector_name_required" };

  if (mode === "GATEWAY") {
    if (!opts.nativeGateway) return { ok: false, error: "native_gateway_disabled" };
    const protocol = str(body.protocol).toUpperCase();
    if (!PROTOCOLS.includes(protocol as (typeof PROTOCOLS)[number])) return { ok: false, error: "invalid_protocol" };
    const targetHost = str(body.targetHost);
    const targetPort = typeof body.targetPort === "number" ? body.targetPort : Number(str(body.targetPort));
    const username = str(body.username);
    const secret = typeof body.secret === "string" ? body.secret : "";
    if (!targetHost || !username) return { ok: false, error: "remote_desktop_fields_required" };
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) return { ok: false, error: "invalid_port" };
    if (opts.requireSecret && !secret) return { ok: false, error: "remote_desktop_fields_required" };
    return { ok: true, mode: "GATEWAY", connectorId, name, description, protocol: protocol as "RDP" | "SSH" | "VNC", targetHost, targetPort, username, secret: secret || null };
  }

  const hostname = str(body.hostname).toLowerCase();
  const upstreamUrl = str(body.upstreamUrl);
  if (!hostname) return { ok: false, error: "invalid_hostname" };
  if (!upstreamUrl) return { ok: false, error: "connector_name_upstream_required" };
  try {
    const u = new URL(upstreamUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "invalid_upstream_url" };
  } catch {
    return { ok: false, error: "invalid_upstream_url" };
  }
  const clip = str(body.clipboardMode);
  const clipboardMode = CLIP.includes(clip) ? clip : "allow";
  const recordSessions = opts.recordingEnabled && body.recordSessions === true;
  return { ok: true, mode: "TRANSPARENT", connectorId, name, hostname, upstreamUrl, description, insecureSkipVerify: body.insecureSkipVerify === true, clipboardMode, recordSessions };
}
```

- [ ] **Step 5: Run to pass.** `pnpm test src/lib/site/validate.test.ts` → PASS (7 tests).

- [ ] **Step 6: Commit.**

```bash
cd /opt/captivo-access && git add prisma/schema.prisma src/lib/site/validate.ts src/lib/site/validate.test.ts && git commit -m "feat(sites): nullable hostname + per-type site input validator"
```

---

### Task 2: Create + update routes (validator + gateway transaction)

**Files:**
- Modify: `src/app/api/admin/sites/route.ts`
- Modify: `src/app/api/admin/sites/[id]/route.ts`
- Modify: `src/lib/vault/store.ts` (add `getVaultCredentialMeta`)

**Interfaces:**
- Consumes: `validateSiteInput` (Task 1), `encrypt` (`@/lib/crypto`), `nativeGatewayEnabled` (`@/lib/gateway/native`), `recordingEnabled`, `db`.
- Produces: `getVaultCredentialMeta(siteId): Promise<{ protocol: string; targetHost: string; targetPort: number; username: string; hasSecret: true } | null>`.

- [ ] **Step 1: Add `getVaultCredentialMeta` to `store.ts`** (non-secret fields for seeding the form — the secret is never returned):

```ts
export async function getVaultCredentialMeta(siteId: string) {
  const c = await db.vaultCredential.findUnique({
    where: { siteId },
    select: { protocol: true, targetHost: true, targetPort: true, username: true },
  });
  return c ? { ...c, hasSecret: true as const } : null;
}
```

- [ ] **Step 2: Rewrite the create route body.** In `src/app/api/admin/sites/route.ts`, replace the field parsing + validation + `db.site.create` with the validator + branched writes. Keep the auth guard, connector-exists check, and logo handling.

```ts
import { validateSiteInput } from "@/lib/site/validate";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { encrypt } from "@/lib/crypto";
// …after auth guard…
const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
const v = validateSiteInput(body, { nativeGateway: nativeGatewayEnabled(), requireSecret: true, recordingEnabled: recordingEnabled() });
if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.error === "native_gateway_disabled" ? 403 : 400 });

const connector = await db.connector.findUnique({ where: { id: v.connectorId }, select: { id: true } });
if (!connector) return NextResponse.json({ error: "connector_not_found" }, { status: 400 });

const logoResult = parseLogoUpload(body.logo, body.logoType);
if (logoResult.action === "error") return NextResponse.json({ error: logoResult.error }, { status: 400 });
const logoData = logoResult.action === "set" ? { logo: logoResult.data, logoType: logoResult.type } : {};

if (v.mode === "TRANSPARENT") {
  const site = await db.site.create({
    data: { connectorId: v.connectorId, name: v.name, hostname: v.hostname, upstreamUrl: v.upstreamUrl, description: v.description, insecureSkipVerify: v.insecureSkipVerify, recordSessions: v.recordSessions, clipboardMode: v.clipboardMode, accessMode: "TRANSPARENT", ...logoData },
    select: { id: true },
  });
  return NextResponse.json({ id: site.id });
}
// GATEWAY: site (null hostname/upstream) + credential, atomically.
const encSecret = encrypt(v.secret as string);
const id = await db.$transaction(async (tx) => {
  const site = await tx.site.create({
    data: { connectorId: v.connectorId, name: v.name, hostname: null, upstreamUrl: null, description: v.description, accessMode: "GATEWAY", ...logoData },
    select: { id: true },
  });
  await tx.vaultCredential.create({
    data: { siteId: site.id, protocol: v.protocol, targetHost: v.targetHost, targetPort: v.targetPort, username: v.username, secret: encSecret, secretKind: "PASSWORD" },
  });
  return site.id;
});
return NextResponse.json({ id });
```

- [ ] **Step 3: Rewrite the update route body** in `src/app/api/admin/sites/[id]/route.ts` similarly, with `requireSecret: false` (an update may keep the stored secret) and upsert:

```ts
const v = validateSiteInput(body, { nativeGateway: nativeGatewayEnabled(), requireSecret: false, recordingEnabled: recordingEnabled() });
if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.error === "native_gateway_disabled" ? 403 : 400 });
// …connector-exists, existing-site, logo as before…

if (v.mode === "TRANSPARENT") {
  try {
    await db.site.update({ where: { id }, data: { connectorId: v.connectorId, name: v.name, hostname: v.hostname, upstreamUrl: v.upstreamUrl, description: v.description, insecureSkipVerify: v.insecureSkipVerify, recordSessions: v.recordSessions, clipboardMode: v.clipboardMode, accessMode: "TRANSPARENT", ...logoData } });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") return NextResponse.json({ error: "hostname_taken" }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
// GATEWAY update: site + vault upsert, atomically. Only overwrite the secret if a new one was given.
const secretData = v.secret ? { secret: encrypt(v.secret) } : {};
await db.$transaction(async (tx) => {
  await tx.site.update({ where: { id }, data: { connectorId: v.connectorId, name: v.name, hostname: null, upstreamUrl: null, description: v.description, accessMode: "GATEWAY", ...logoData } });
  await tx.vaultCredential.upsert({
    where: { siteId: id },
    create: { siteId: id, protocol: v.protocol, targetHost: v.targetHost, targetPort: v.targetPort, username: v.username, secret: encrypt(v.secret ?? ""), secretKind: "PASSWORD" },
    update: { protocol: v.protocol, targetHost: v.targetHost, targetPort: v.targetPort, username: v.username, ...secretData },
  });
});
return NextResponse.json({ ok: true });
```
  > If an update creates the vault for the first time (`create` branch) with no secret given, that's a misconfigured call — but the validator with `requireSecret:false` allows it. To be safe, if the site has no existing vault AND no secret was given, reject: before the transaction, `const hadVault = await db.vaultCredential.count({ where: { siteId: id } }) > 0; if (v.mode === "GATEWAY" && !hadVault && !v.secret) return NextResponse.json({ error: "remote_desktop_fields_required" }, { status: 400 });`

- [ ] **Step 4: Verify build.** `pnpm build` → passes.

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add src/app/api/admin/sites/route.ts "src/app/api/admin/sites/[id]/route.ts" src/lib/vault/store.ts && git commit -m "feat(sites): create/update branch by type — remote-desktop writes site+credential atomically"
```

---

### Task 3: Site form (type selector + remote-desktop fields) + remove standalone vault section

**Files:**
- Modify: `src/app/(app)/admin/sites/site-form.tsx`
- Modify: `src/app/(app)/admin/sites/[id]/edit/page.tsx`
- Modify: `src/app/(app)/admin/sites/add-site-button.tsx` and/or `sites-view.tsx` (thread `nativeGateway`)

**Interfaces:**
- Consumes: `getVaultCredentialMeta` (Task 2), `nativeGatewayEnabled` (`@/lib/gateway/native`).

- [ ] **Step 1: Thread `nativeGateway` + vault seed into the form.**
  - In `site-form.tsx`, extend the props: add `nativeGateway: boolean` and an optional `vault?: { protocol: string; targetHost: string; targetPort: number; username: string; hasSecret: boolean }` (for editing a remote-desktop site).
  - Add state for remote-desktop fields seeded from `vault`: `protocol` (default `vault?.protocol ?? "RDP"`), `targetHost`, `targetPort` (default `String(vault?.targetPort ?? 3389)`), `username`, `secret` (always empty; write-only).
  - Keep `accessMode` state; the selector offers "Remote desktop" only when `nativeGateway`.

- [ ] **Step 2: Add the type selector + branch the fields.** In the form JSX:
  - A labelled selector "Type" → Web app (TRANSPARENT) / Remote desktop (GATEWAY, shown only if `nativeGateway`).
  - When `accessMode === "TRANSPARENT"`: render the existing hostname / internal-address / recording / clipboard fields.
  - When `accessMode === "GATEWAY"`: render **protocol** (RDP/SSH/VNC select), **target host**, **port**, **username**, **secret** (`type="password"`, placeholder `vault?.hasSecret ? "•••• (stored — type to replace)" : "target password"`). Hide hostname/internal-address/clipboard/recording.

- [ ] **Step 3: Send the right body per type.** In the form's save `fetch` body, always send `accessMode`; when GATEWAY also send `protocol, targetHost, targetPort: Number(port), username, secret`; when TRANSPARENT send `hostname, upstreamUrl, recordSessions, clipboardMode` as today. Map the new server error codes to messages: `remote_desktop_fields_required` → "Fill protocol, host, port, username, and password.", `invalid_protocol` → "Pick a protocol.", `invalid_port` → "Port must be 1–65535.", `native_gateway_disabled` → "Remote desktop gateway is not enabled."

- [ ] **Step 4: Remove the standalone vault section + seed the form on the edit page.** In `src/app/(app)/admin/sites/[id]/edit/page.tsx`:
  - Delete the `showVault`/`VaultCredentialForm` block and its imports.
  - Load the vault meta: `const vault = site.accessMode === "GATEWAY" ? await getVaultCredentialMeta(site.id) : null;`
  - Pass to the form: `<SiteForm … nativeGateway={nativeGatewayEnabled()} vault={vault ?? undefined} />` (import `nativeGatewayEnabled` from `@/lib/gateway/native`, `getVaultCredentialMeta` from `@/lib/vault/store`).

- [ ] **Step 5: Thread `nativeGateway` into the add-site form.** Wherever the add-site form is rendered (`add-site-button.tsx` / `sites-view.tsx`), pass `nativeGateway={nativeGatewayEnabled()}` (read it server-side and thread the boolean down, mirroring how `recordingEnabled` is already threaded).

- [ ] **Step 6: Verify build.** `pnpm build` → passes.

- [ ] **Step 7: Manual check.** With `NATIVE_GATEWAY=1`: add a Remote desktop site (protocol/host/port/user/secret) → the `VaultCredential` is stored and the site has null hostname; editing it re-seeds the fields (secret blank); Web app sites are unaffected; with the gate off, the Remote desktop type isn't offered.

- [ ] **Step 8: Commit.**

```bash
cd /opt/captivo-access && git add "src/app/(app)/admin/sites" && git commit -m "feat(sites): unified site form — Web app vs Remote desktop (native), vault merged inline"
```

---

## Deployment (after all tasks reviewed)

- `db push` makes `hostname` nullable (additive-safe). Bump manager + migrate together, run the migrate one-shot, restart the manager.
- Manager only; data-plane/connector unchanged. `NATIVE_GATEWAY` already on in prod.

## Self-Review

**Spec coverage:**
- Two types via `accessMode`, relabeled → Task 3 (selector). ✓
- `hostname` nullable → Task 1 (schema) + Tasks 2 (null on gateway writes). ✓
- Vault merged into the form → Task 3 (fields) + Task 2 (transaction writes). ✓
- Save branches by type; gateway = site+vault transaction → Task 2. ✓
- Remove standalone vault section → Task 3 Step 4. ✓
- Gated by `nativeGatewayEnabled()` → Task 1 (validator), Task 2 (routes), Task 3 (form). ✓
- Recording toggle out of scope → not added; gateway `recordSessions` stays false (no gateway recordSessions write). ✓
- Existing gateway sites: form stops using hostname/upstream, seeds from vault → Task 3. ✓
- Manager only → respected. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. Task 3's form edits reference the existing form's fields by role (the implementer integrates with the current JSX) — concrete new pieces (state, selector, gateway block, body) are given.

**Type consistency:** `validateSiteInput(body, {nativeGateway, requireSecret, recordingEnabled})` → `SiteValidation` (Task 1) consumed in both routes (Task 2). `getVaultCredentialMeta` shape (Task 2) matches the form's `vault` prop (Task 3). Error codes (`remote_desktop_fields_required`/`invalid_protocol`/`invalid_port`/`native_gateway_disabled`/`invalid_hostname`/`invalid_upstream_url`/`connector_name_upstream_required`) are produced by the validator (Task 1) and mapped in the form (Task 3). `protocol` normalized to uppercase `RDP|SSH|VNC` in the validator, stored as `VaultProtocol` enum.
