# Credential Vault (V1 + V2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store RDP/SSH/VNC target credentials encrypted in Captivo and inject them into a Guacamole gateway session so a vendor connects without ever seeing the password or logging into Guacamole.

**Architecture:** A `VaultCredential` (encrypted at rest) is attached to a GATEWAY site. A pure module produces the `guacamole-auth-json` signed+encrypted `data` blob. A manager launch endpoint checks the grant, builds the blob from the vault, and hands the vendor an authenticated Guacamole session — browser-driven (the manager cannot POST server-side through the connector: `proxyThroughConnector` sends no body and truncates the response). Manager + database + gateway-pack only; the Go data-plane and connector are unchanged.

**Tech Stack:** Next.js (App Router, Node runtime), Prisma 7 (`db push`), Postgres, Node `crypto` (AES-256-GCM for at-rest, AES-128-CBC + HMAC-SHA256 for the Guacamole blob), Vitest, Apache Guacamole + `guacamole-auth-json` extension.

## Global Constraints

- **English only** in all code, comments, commit messages, UI strings, docs.
- **No Claude signature** in commits.
- **Prisma `db push`**, never `migrate`. Local: `pnpm db:generate` unlocks build/tests; the real DB is applied at deploy by the versioned `migrate` one-shot. **Deploy: bump BOTH `access-manager` and `access-migrate` to the release + run `docker compose run --rm access-migrate`** (a single `up -d access-manager` does NOT re-run migrate; a manual host-side push is unreliable).
- **Manager only.** Do not modify the Go data-plane or connector. Injection is browser-driven precisely because the manager cannot server-side POST through the connector.
- **Capability-gated, off by default:** `VAULT_ENABLED` env (`1`/`true`/`on`), mirroring `recordingEnabled()`. When off: vault UI hidden, launch endpoint returns disabled, GATEWAY Open falls back to the direct link.
- **Secret never leaves the server in plaintext.** At-rest via `@/lib/crypto` `encrypt()`/`decrypt()` (AES-256-GCM, `ENCRYPTION_KEY`). The admin secret field is write-only (shows set/not-set, never the value). Never log the plaintext.
- **Blob format (frozen), matches `guacamole-auth-json`:** `base64( AES-128-CBC( HMAC-SHA256(json) ‖ json ) )`, key = 16 bytes of the hex `JSON_SECRET_KEY` (32 hex chars), IV = 16 zero bytes.

---

## File Structure

- `src/lib/vault/guac-json.ts` (new) — `buildAuthData` (the blob) + `GuacAuthDoc` type.
- `src/lib/vault/guac-json.test.ts` (new) — round-trip unit test.
- `src/lib/vault/enabled.ts` (new) — `vaultEnabled()` gate.
- `src/lib/vault/enabled.test.ts` (new) — gate unit test.
- `prisma/schema.prisma` — `VaultCredential` model + two enums + `Site.vaultCredential` back-relation.
- `src/lib/vault/store.ts` (new) — `setVaultCredential` / `getVaultCredential` / `clearVaultCredential` / `hasVaultCredential` (encrypt/decrypt at the boundary).
- `src/app/api/admin/sites/[id]/vault/route.ts` (new) — PUT (set) / DELETE (clear), admin-gated.
- `src/app/(app)/admin/sites/...` — a "Vault credential" section on the GATEWAY site view (write-only secret).
- `src/app/api/access/gateway/[siteId]/launch/route.ts` (new) — the injection launch.
- `src/app/(app)/access/page.tsx` + `access-view.tsx` — surface `accessMode`; GATEWAY Open → launch.
- `deploy/gateway/` + `src/lib/gateway/assets.ts` — bundle `guacamole-auth-json` + shared `JSON_SECRET_KEY`.

---

### Task 1: Guacamole auth-JSON blob module + de-risk spike

**Files:**
- Create: `src/lib/vault/guac-json.ts`
- Create: `src/lib/vault/guac-json.test.ts`

**Interfaces:**
- Produces:
  - `type GuacAuthDoc = { username: string; expires: number; connections: Record<string, { protocol: string; parameters: Record<string, string> }> }`.
  - `buildAuthData(secretHex: string, doc: GuacAuthDoc): string` — the base64 `data` blob.

- [ ] **Step 1: Write the failing round-trip test.** In `src/lib/vault/guac-json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDecipheriv, createHmac } from "node:crypto";
import { buildAuthData, type GuacAuthDoc } from "./guac-json";

const KEY = "00112233445566778899aabbccddeeff"; // 16 bytes / 32 hex chars
const DOC: GuacAuthDoc = {
  username: "vendor@example.com",
  expires: 1893456000000,
  connections: { "Prod DB": { protocol: "ssh", parameters: { hostname: "10.0.0.5", port: "22", username: "root", password: "s3cret" } } },
};

// Mirror of what guacamole-auth-json does to decode the blob, to prove format.
function decode(secretHex: string, data: string) {
  const key = Buffer.from(secretHex, "hex");
  const ct = Buffer.from(data, "base64");
  const d = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  const signed = Buffer.concat([d.update(ct), d.final()]);
  const sig = signed.subarray(0, 32);
  const json = signed.subarray(32);
  const expect = createHmac("sha256", key).update(json).digest();
  return { sigOk: sig.equals(expect), doc: JSON.parse(json.toString("utf8")) };
}

describe("buildAuthData", () => {
  it("produces a blob that decrypts, verifies its HMAC, and round-trips the doc", () => {
    const data = buildAuthData(KEY, DOC);
    const { sigOk, doc } = decode(KEY, data);
    expect(sigOk).toBe(true);
    expect(doc).toEqual(DOC);
  });
  it("rejects a wrong-length secret", () => {
    expect(() => buildAuthData("abcd", DOC)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `pnpm test src/lib/vault/guac-json.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/vault/guac-json.ts`.**

```ts
import { createHmac, createCipheriv } from "node:crypto";

export type GuacAuthDoc = {
  username: string;
  expires: number; // epoch millis; keep short-lived
  connections: Record<string, { protocol: string; parameters: Record<string, string> }>;
};

// Produces the base64 `data` blob the guacamole-auth-json extension accepts:
// base64( AES-128-CBC( HMAC-SHA256(json) ‖ json ) ), key = 16 bytes of the hex
// secret, IV = 16 zero bytes. Byte-format must match the extension exactly.
export function buildAuthData(secretHex: string, doc: GuacAuthDoc): string {
  const key = Buffer.from(secretHex, "hex");
  if (key.length !== 16) throw new Error("JSON_SECRET_KEY must be 128-bit (32 hex chars)");
  const json = Buffer.from(JSON.stringify(doc), "utf8");
  const sig = createHmac("sha256", key).update(json).digest(); // 32 bytes
  const signed = Buffer.concat([sig, json]);
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  const ct = Buffer.concat([cipher.update(signed), cipher.final()]);
  return ct.toString("base64");
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `pnpm test src/lib/vault/guac-json.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/vault/guac-json.ts src/lib/vault/guac-json.test.ts && git commit -m "feat(vault): guacamole-auth-json signed+encrypted blob generator"
```

- [ ] **Step 6: MANUAL DE-RISK SPIKE (operator-run, gates Task 5).** This resolves the two unknowns before the launch flow is built. Do this against a local gateway:

  1. Generate a key: `openssl rand -hex 16` → `JSON_SECRET_KEY`.
  2. Add the extension to the gateway's Guacamole: download `guacamole-auth-json-1.5.5.jar` into the container's `GUACAMOLE_HOME/extensions`, set `JSON_SECRET_KEY` env, restart Guacamole.
  3. Build a blob with `buildAuthData(<key>, <doc for a real RDP/SSH target>)` (a 5-line node script importing the module).
  4. **Format check:** `curl --data-urlencode "data=<blob>" http://localhost:<GUAC_PORT>/guacamole/api/tokens` → expect `200` with `{"authToken":...,"dataSource":"json",...}`. If this fails, the blob format is wrong — fix `buildAuthData` before proceeding.
  5. **Handoff check (the key question):** in a browser, navigate to `http://localhost:<GUAC_PORT>/guacamole/#/?data=<url-encoded blob>` and, separately, try a page that `fetch`es `/guacamole/api/tokens` with `data=` (same origin), stores `authToken`, and loads `/guacamole/#/`. **Record which one drops you straight into the connection.** That mechanism is what Task 5 implements.

  Record the outcome (format OK? which handoff worked?) in the ledger / report before starting Task 5. If neither handoff authenticates the browser session, STOP and revisit the design with the user — do not build Task 5 blind.

---

### Task 2: Schema (VaultCredential + enums + relation) + capability gate

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/vault/enabled.ts`
- Create: `src/lib/vault/enabled.test.ts`

**Interfaces:**
- Produces: Prisma `VaultCredential` model + `VaultProtocol`/`VaultSecretKind` enums + `Site.vaultCredential`; `vaultEnabled(): boolean`.

- [ ] **Step 1: Add the schema.** In `prisma/schema.prisma`, add the enums + model, and the back-relation on `Site`:

```prisma
enum VaultProtocol { RDP SSH VNC }
enum VaultSecretKind { PASSWORD KEY }

model VaultCredential {
  id         String          @id @default(cuid())
  siteId     String          @unique
  site       Site            @relation(fields: [siteId], references: [id], onDelete: Cascade)
  protocol   VaultProtocol
  targetHost String
  targetPort Int
  username   String
  secret     String          // AES-256-GCM ciphertext (password OR private key)
  secretKind VaultSecretKind @default(PASSWORD)
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
}
```

  On the `Site` model, add: `vaultCredential VaultCredential?`

- [ ] **Step 2: Generate the client.** Run `pnpm db:generate`. Expected: "Generated Prisma Client". (Real DB is applied at deploy via the migrate one-shot.)

- [ ] **Step 3: Write the failing gate test.** In `src/lib/vault/enabled.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { vaultEnabled } from "./enabled";

const ORIGINAL = process.env.VAULT_ENABLED;
beforeEach(() => { delete process.env.VAULT_ENABLED; });
afterAll(() => { if (ORIGINAL === undefined) delete process.env.VAULT_ENABLED; else process.env.VAULT_ENABLED = ORIGINAL; });

describe("vaultEnabled", () => {
  it("is off by default", () => expect(vaultEnabled()).toBe(false));
  it("is on for 1/true/on", () => {
    for (const v of ["1", "true", "on", "ON", "True"]) { process.env.VAULT_ENABLED = v; expect(vaultEnabled()).toBe(true); }
  });
  it("is off for other values", () => { process.env.VAULT_ENABLED = "no"; expect(vaultEnabled()).toBe(false); });
});
```

- [ ] **Step 4: Run the test to verify it fails.** Run: `pnpm test src/lib/vault/enabled.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 5: Implement `src/lib/vault/enabled.ts`** (mirrors `src/lib/recording/enabled.ts`):

```ts
// The single capability gate for the credential vault (Pro). Source is
// swappable (env now; license later) — callers must not assume env specifically.
export function vaultEnabled(): boolean {
  const v = process.env.VAULT_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
```

- [ ] **Step 6: Run the test to verify it passes.** Run: `pnpm test src/lib/vault/enabled.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 7: Verify build.** Run `pnpm build`. Expected: BUILD passes.

- [ ] **Step 8: Commit.**

```bash
cd /opt/captivo-access && git add prisma/schema.prisma src/lib/vault/enabled.ts src/lib/vault/enabled.test.ts && git commit -m "feat(vault): VaultCredential schema + VAULT_ENABLED capability gate"
```

---

### Task 3: Vault storage lib + admin API

**Files:**
- Create: `src/lib/vault/store.ts`
- Create: `src/app/api/admin/sites/[id]/vault/route.ts`

**Interfaces:**
- Consumes: `encrypt`/`decrypt` (`@/lib/crypto`), `db`, `VaultProtocol`/`VaultSecretKind` (Task 2).
- Produces:
  - `setVaultCredential(input: { siteId: string; protocol: "RDP"|"SSH"|"VNC"; targetHost: string; targetPort: number; username: string; secret: string; secretKind: "PASSWORD"|"KEY" }): Promise<void>` — upsert, encrypting `secret`.
  - `getVaultCredential(siteId: string): Promise<{ protocol: string; targetHost: string; targetPort: number; username: string; secret: string; secretKind: string } | null>` — decrypts `secret`. Server-only.
  - `hasVaultCredential(siteId: string): Promise<boolean>`.
  - `clearVaultCredential(siteId: string): Promise<void>`.

- [ ] **Step 1: Implement `src/lib/vault/store.ts`.**

```ts
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import type { VaultProtocol, VaultSecretKind } from "@/generated/prisma/enums";

export type VaultInput = {
  siteId: string;
  protocol: VaultProtocol;
  targetHost: string;
  targetPort: number;
  username: string;
  secret: string; // plaintext in; encrypted at rest
  secretKind: VaultSecretKind;
};

export async function setVaultCredential(input: VaultInput): Promise<void> {
  const data = {
    protocol: input.protocol,
    targetHost: input.targetHost.trim(),
    targetPort: input.targetPort,
    username: input.username.trim(),
    secret: encrypt(input.secret),
    secretKind: input.secretKind,
  };
  await db.vaultCredential.upsert({
    where: { siteId: input.siteId },
    create: { siteId: input.siteId, ...data },
    update: data,
  });
}

export async function getVaultCredential(siteId: string) {
  const c = await db.vaultCredential.findUnique({ where: { siteId } });
  if (!c) return null;
  return {
    protocol: c.protocol,
    targetHost: c.targetHost,
    targetPort: c.targetPort,
    username: c.username,
    secret: decrypt(c.secret),
    secretKind: c.secretKind,
  };
}

export async function hasVaultCredential(siteId: string): Promise<boolean> {
  return (await db.vaultCredential.count({ where: { siteId } })) > 0;
}

export async function clearVaultCredential(siteId: string): Promise<void> {
  await db.vaultCredential.deleteMany({ where: { siteId } });
}
```

- [ ] **Step 2: Implement the admin route `src/app/api/admin/sites/[id]/vault/route.ts`.** PUT sets, DELETE clears; both `configure`-gated and `vaultEnabled`-gated; validates protocol/port.

```ts
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { vaultEnabled } from "@/lib/vault/enabled";
import { setVaultCredential, clearVaultCredential } from "@/lib/vault/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOLS = ["RDP", "SSH", "VNC"] as const;
const KINDS = ["PASSWORD", "KEY"] as const;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!vaultEnabled()) return NextResponse.json({ error: "vault_disabled" }, { status: 403 });

  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const protocol = String(b.protocol) as (typeof PROTOCOLS)[number];
  const secretKind = String(b.secretKind ?? "PASSWORD") as (typeof KINDS)[number];
  const port = Number(b.targetPort);
  const targetHost = typeof b.targetHost === "string" ? b.targetHost.trim() : "";
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const secret = typeof b.secret === "string" ? b.secret : "";
  if (!PROTOCOLS.includes(protocol) || !KINDS.includes(secretKind)) return NextResponse.json({ error: "invalid_protocol" }, { status: 400 });
  if (!targetHost || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !secret) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }
  await setVaultCredential({ siteId: id, protocol, targetHost, targetPort: port, username, secret, secretKind });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  await clearVaultCredential(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify build.** Run `pnpm build`. Expected: BUILD passes.

- [ ] **Step 4: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/vault/store.ts "src/app/api/admin/sites/[id]/vault/route.ts" && git commit -m "feat(vault): encrypted credential store + admin set/clear API"
```

---

### Task 4: Admin UI — vault section on the GATEWAY site view

**Files:**
- Modify: the GATEWAY site's admin view (find it: `grep -rl "accessMode" src/app/(app)/admin/sites`)
- Create: `src/app/(app)/admin/sites/.../vault-credential-form.tsx` (client component, sibling to the site view)

**Interfaces:**
- Consumes: the PUT/DELETE route (Task 3), `hasVaultCredential` (Task 3), `vaultEnabled` (Task 2).

- [ ] **Step 1: Add a client form component `vault-credential-form.tsx`.** Renders protocol select, target host, port, username, a write-only secret field (type=password, placeholder "•••• (set)" when a credential already exists), a Save button (PUT) and a Clear button (DELETE). It never receives the stored secret — only a boolean `hasSecret`.

```tsx
"use client";
import { useState } from "react";

export function VaultCredentialForm({ siteId, hasSecret }: { siteId: string; hasSecret: boolean }) {
  const [protocol, setProtocol] = useState("RDP");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3389");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [secretKind, setSecretKind] = useState("PASSWORD");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function save() {
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/admin/sites/${siteId}/vault`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocol, targetHost: host, targetPort: Number(port), username, secret, secretKind }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice(res.ok && body.ok ? { kind: "ok", msg: "Saved. The vendor will connect without entering the password." } : { kind: "err", msg: "Could not save — check the fields." });
    if (res.ok && body.ok) setSecret("");
  }
  async function clear() {
    setBusy(true); setNotice(null);
    await fetch(`/api/admin/sites/${siteId}/vault`, { method: "DELETE" });
    setBusy(false); setNotice({ kind: "ok", msg: "Credential cleared." });
  }

  return (
    <div className="card">
      <div className="card-head"><h2>Vault credential</h2>{hasSecret && <span className="pill ok">Set</span>}</div>
      <div className="field"><label className="field-label">Protocol</label>
        <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="RDP">RDP</option><option value="SSH">SSH</option><option value="VNC">VNC</option>
        </select></div>
      <div className="field"><label className="field-label">Target host</label><input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.5" /></div>
      <div className="field"><label className="field-label">Port</label><input className="input" type="number" value={port} onChange={(e) => setPort(e.target.value)} /></div>
      <div className="field"><label className="field-label">Username</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div className="field"><label className="field-label">Secret</label>
        <select className="select" value={secretKind} onChange={(e) => setSecretKind(e.target.value)}><option value="PASSWORD">Password</option><option value="KEY">Private key</option></select>
        <textarea className="textarea" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={hasSecret ? "•••••••• (stored — type to replace)" : "Enter the target password or private key"} /></div>
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`}>{notice.msg}</p>}
      <div className="row-actions"><button className="btn primary" onClick={save} disabled={busy}>Save</button>{hasSecret && <button className="btn ghost" onClick={clear} disabled={busy}>Clear</button>}</div>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the GATEWAY site view, gated.** In the site admin page (server component), when `vaultEnabled()` and the site's `accessMode === "GATEWAY"`, render `<VaultCredentialForm siteId={site.id} hasSecret={await hasVaultCredential(site.id)} />`. Import `vaultEnabled` from `@/lib/vault/enabled` and `hasVaultCredential` from `@/lib/vault/store`. Do not render for TRANSPARENT sites or when the gate is off.

- [ ] **Step 3: Verify build.** Run `pnpm build`. Expected: BUILD passes.

- [ ] **Step 4: Commit.**

```bash
cd /opt/captivo-access && git add "src/app/(app)/admin/sites" && git commit -m "feat(vault): admin UI to set a GATEWAY site's target credential"
```

---

### Task 5: Injection launch flow + vendor Open — **gated on the Task 1 spike**

> Do not start until Task 1 Step 6 (the spike) confirms the blob format authenticates and identifies the working browser handoff. The handoff code below is the leading candidate (browser carries `data` to the gateway origin); adjust the redirect target/shape to whatever the spike proved.

**Files:**
- Create: `src/app/api/access/gateway/[siteId]/launch/route.ts`
- Modify: `src/app/(app)/access/page.tsx` (surface `accessMode` on rows)
- Modify: `src/app/(app)/access/access-view.tsx` (GATEWAY Open → launch)
- Modify: `deploy/gateway/` + `src/lib/gateway/assets.ts` (extension + `JSON_SECRET_KEY`)

**Interfaces:**
- Consumes: `buildAuthData` (Task 1), `getVaultCredential` (Task 3), `vaultEnabled` (Task 2), `evaluateAccess(userId, siteId, now)` (`@/lib/access/evaluate`, returns `{ allow: boolean; reason?: string }`), `requireUser` (`@/lib/current-user`).

- [ ] **Step 1: Implement the launch endpoint `src/app/api/access/gateway/[siteId]/launch/route.ts`.** Builds the blob and redirects the browser to the gateway host carrying `data` (leading candidate per spike).

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { evaluateAccess } from "@/lib/access/evaluate";
import { db } from "@/lib/db";
import { vaultEnabled } from "@/lib/vault/enabled";
import { getVaultCredential } from "@/lib/vault/store";
import { buildAuthData, type GuacAuthDoc } from "@/lib/vault/guac-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { hostname: true, name: true, accessMode: true } });
  if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const fallback = NextResponse.redirect(`https://${site.hostname}`);
  // Gate off or non-gateway or no credential → behave like the old direct link.
  if (!vaultEnabled() || site.accessMode !== "GATEWAY") return fallback;

  const decision = await evaluateAccess(user.id, siteId, new Date());
  if (!decision.allow) return NextResponse.json({ error: "forbidden", reason: decision.reason }, { status: 403 });

  const cred = await getVaultCredential(siteId);
  const secretHex = (process.env.GUAC_JSON_SECRET_KEY ?? "").trim();
  if (!cred || secretHex.length !== 32) return fallback; // no creds / not configured → manual login

  const doc: GuacAuthDoc = {
    username: user.email,
    expires: Date.now() + 60_000, // short-lived
    connections: {
      [site.name]: {
        protocol: cred.protocol.toLowerCase(),
        parameters: {
          hostname: cred.targetHost,
          port: String(cred.targetPort),
          username: cred.username,
          ...(cred.secretKind === "KEY" ? { "private-key": cred.secret } : { password: cred.secret }),
          "recording-path": "/recordings",
          "recording-name": `${siteId}-${user.id}-${Date.now()}`,
          "recording-include-keys": "true",
        },
      },
    },
  };
  const data = buildAuthData(secretHex, doc);
  // LEADING CANDIDATE handoff (confirm/adjust from the Task 1 spike): browser
  // carries `data` to the gateway origin, where guacamole-auth-json authenticates.
  return NextResponse.redirect(`https://${site.hostname}/guacamole/#/?data=${encodeURIComponent(data)}`);
}
```

- [ ] **Step 2: Surface `accessMode` on the access rows.** In `src/app/(app)/access/page.tsx`, add `accessMode: g.site.accessMode` to each pushed `AccessRow` (and select it in `listUserGrants` if not already present — check `src/lib/access/grants.ts` and add `accessMode: true` to the site select there if missing). In `access-view.tsx`, add `accessMode: string` to the `AccessRow` interface.

- [ ] **Step 3: Route GATEWAY Open through the launch endpoint.** In `access-view.tsx`, in `RowAction`, when `r.status === "active"`: if `r.accessMode === "GATEWAY"`, render `<a className="btn sm" href={`/api/access/gateway/${r.siteId}/launch`} target="_blank" rel="noopener noreferrer">Open ↗</a>`; otherwise keep the existing `https://${r.hostname}` link.

- [ ] **Step 4: Bundle the extension + shared key in the gateway pack.** In `deploy/gateway/` (and mirror into `src/lib/gateway/assets.ts` via `scripts/gen-gateway-assets` if that generator exists): install `guacamole-auth-json-1.5.5.jar` into the Guacamole container's `GUACAMOLE_HOME/extensions`, and have `setup.sh` generate `JSON_SECRET_KEY` (`openssl rand -hex 16`), write it to `.env.gateway`, and pass it to Guacamole. Document that the SAME value must be set as `GUAC_JSON_SECRET_KEY` on the Captivo manager. Update `deploy/gateway/README.md`.

- [ ] **Step 5: Verify build + full suite.** Run `pnpm test && pnpm build`. Expected: all PASS, BUILD passes.

- [ ] **Step 6: Gate A (operator).** With `VAULT_ENABLED=1` + `GUAC_JSON_SECRET_KEY` matching the gateway, a GATEWAY site with a vault credential: click Open in `/access` → land in the recorded RDP/SSH session with no Guacamole login and no password entry. A denied grant → 403. Gate off → manual login as before.

- [ ] **Step 7: Commit.**

```bash
cd /opt/captivo-access && git add "src/app/api/access/gateway" "src/app/(app)/access" deploy/gateway src/lib/gateway/assets.ts src/lib/access/grants.ts && git commit -m "feat(vault): gateway injection launch + vendor Open + gateway-pack json-auth"
```

---

## Deployment (after all tasks reviewed + spike confirmed)

- `db push` adds `VaultCredential` + enums (additive). Bump **both** `access-manager` and `access-migrate` to the release, run `docker compose run --rm access-migrate`, then restart the manager.
- Set `GUAC_JSON_SECRET_KEY` (manager) = `JSON_SECRET_KEY` (gateway). Operators re-run `deploy/gateway/setup.sh` for the extension + key.
- `VAULT_ENABLED` stays off until you turn the Pro tier on.
- Data-plane and connector unchanged.

## Self-Review

**Spec coverage:**
- One credential per GATEWAY site → `VaultCredential.siteId @unique` (Task 2). ✓
- Task 1 de-risk spike before building injection → Task 1 Step 6 + Task 5 gated on it. ✓
- `VAULT_ENABLED` off by default → Task 2 gate; used in Task 3 route, Task 4 UI, Task 5 launch. ✓
- Manager only → no data-plane/connector files; injection browser-driven because `proxyThroughConnector` can't POST a body. ✓
- Encrypted at rest, write-only secret → Task 3 (`encrypt`/`decrypt`), Task 4 (write-only field, `hasSecret` boolean only). ✓
- Blob format (AES-128-CBC + HMAC-SHA256 + zero IV + sig-prepend) → Task 1 `buildAuthData` + round-trip test. ✓
- Gateway pack: extension + shared key → Task 5 Step 4. ✓
- Launch: grant guard + build blob + handoff → Task 5 Step 1. ✓
- Vendor Open routes GATEWAY through launch → Task 5 Steps 2-3. ✓
- Fallbacks (gate off / no cred / non-gateway) → Task 5 Step 1 `fallback`. ✓

**Placeholder scan:** No TBD/TODO. Task 5's handoff is explicitly the spike-confirmed leading candidate with concrete code, not a placeholder — the dependency on Task 1's spike is a real integration gate, called out per the spec.

**Type consistency:** `GuacAuthDoc`/`buildAuthData(secretHex, doc)` (Task 1) used in Task 5. `VaultProtocol`/`VaultSecretKind` (Task 2) used in `store.ts` (Task 3). `getVaultCredential` returns decrypted `{ protocol, targetHost, targetPort, username, secret, secretKind }` (Task 3) consumed in Task 5. `vaultEnabled()` (Task 2) used in Tasks 3/4/5. `evaluateAccess(userId, siteId, now) → { allow, reason? }` matches Task 5 usage.
