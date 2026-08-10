# External Anchor (RFC 3161) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Periodically timestamp the audit hash-chain head with an RFC 3161 Time-Stamp Authority so a full-DB-control attacker cannot back-date a chain rewrite.

**Architecture:** A daily cron endpoint reads the `AuditChainState` head, hashes `seq:hash`, gets an RFC 3161 timestamp token from an admin-configured TSA, and stores it in a new `AuditAnchor` table. The admin console verifies stored tokens and cross-checks them against the live chain, and exposes each token as a downloadable `.tsr` for independent verification. Manager + database + cron only — the data-plane and connector are untouched.

**Tech Stack:** Next.js (App Router, Node runtime), Prisma 7 (`db push`, no migrations), Postgres, `pkijs` + `asn1js` for RFC 3161 ASN.1, Vitest for unit tests.

## Global Constraints

- **English only.** All code, comments, commit messages, UI strings, and docs in English (public OSS repo).
- **No Claude signature** in commits or PRs (no `Co-Authored-By: Claude`, no "Generated with" line).
- **DB model is `prisma db push`**, never `migrate dev`. After schema edits: `cd /opt/captivo-access && npx prisma db push && npx prisma generate` (Prisma 7 needs `PRISMA_USER_CONSENT_FOR_...`? No — this repo uses plain `npx prisma db push`; DB is on `localhost:5434` for local pushes).
- **Opt-in, default off.** No anchoring runs until an admin sets `externalAnchorEnabled = true` AND a non-blank `anchorTsaUrl`.
- **No bundled TSA.** `anchorTsaUrl` default is `""`; the customer enters it.
- **Daily cadence** via the external-cron pattern; operators may schedule more often.
- **Fail-open.** Anchoring failures are logged and retried next run — they NEVER throw out of the cron handler and NEVER block audit ingest.
- **Scope:** audit chain only. Data-plane and connector files must not change.
- **Follow existing patterns:** cron auth (`Bearer CRON_SECRET`) + `recordCronRun`; admin routes gate with `getCurrentUser` + `can(role, …)`; settings via the `env → DB → default` resolver layer in `src/lib/settings/platform.ts`; pure logic in `src/lib/audit/*` with Vitest units alongside.
- **Anchored digest formula (frozen):** `sha256( utf8( `${anchoredSeq}:${anchoredHash}` ) )`. Used identically when anchoring and when verifying.

---

## File Structure

- `prisma/schema.prisma` — new `AuditAnchor` model; 3 new `PlatformSettings` columns.
- `src/lib/audit/rfc3161.ts` — pure RFC 3161 ASN.1: build request, parse response, verify token. Isolated so all `pkijs` usage lives in one file.
- `src/lib/audit/rfc3161.test.ts` — unit tests over committed token fixtures.
- `src/lib/audit/rfc3161.fixtures/` — committed `.tsr`/`.tsq` test vectors + a README on how they were generated.
- `src/lib/settings/platform.ts` — anchor fields in the interface/EMPTY/get/save + resolvers.
- `src/app/api/admin/policy/platform/route.ts` — accept + validate the new settings.
- `src/app/(app)/admin/policy/platform-settings-form.tsx` — UI controls for the new settings.
- `src/lib/audit/anchor.ts` — pure `anchorDigest` + `shouldAnchor`; network `runAnchor`.
- `src/lib/audit/anchor.test.ts` — unit tests for the pure parts.
- `src/app/api/cron/audit-anchor/route.ts` — the daily cron endpoint.
- `src/lib/cron/heartbeat.ts` — extend `CronJob`; gate `audit-anchor` staleness on the setting.
- `src/lib/audit/anchor-verify.ts` — pure per-anchor verdict logic.
- `src/lib/audit/anchor-verify.test.ts` — unit tests.
- `src/app/api/admin/audit/anchors/verify/route.ts` — verify all anchors.
- `src/app/api/admin/audit/anchors/[id]/token/route.ts` — download one token as `.tsr`.
- `src/app/(app)/admin/audit/integrity-panel.tsx` — anchor status + "Verify anchors" + download.
- `src/app/(app)/admin/audit/page.tsx` — fetch last-anchor summary + settings, pass to panel.
- `deploy/setup.sh` + install docs — schedule the daily anchor cron.

---

### Task 1: Schema — `AuditAnchor` + settings columns + `pkijs` dependency

**Files:**
- Modify: `prisma/schema.prisma` (add model + 3 columns)
- Modify: `package.json` (add `pkijs`)

**Interfaces:**
- Produces: Prisma models `AuditAnchor { id, anchoredSeq: BigInt, anchoredHash: String, tsaUrl: String, token: Bytes, genTime: DateTime, createdAt: DateTime }` and `PlatformSettings.externalAnchorEnabled: Boolean?`, `.anchorTsaUrl: String?`, `.anchorTsaAuth: String?`.

- [ ] **Step 1: Add the `AuditAnchor` model.** In `prisma/schema.prisma`, after the `AuditChainState` model, add:

```prisma
// AuditAnchor stores one RFC 3161 timestamp per successful external anchor of
// the audit chain head. Each row is a verifiable proof that the head was
// (anchoredSeq, anchoredHash) at the TSA's genTime — pinning history against a
// later full-DB rewrite. Only successful anchors are stored.
model AuditAnchor {
  id           String   @id @default(cuid())
  anchoredSeq  BigInt
  anchoredHash String
  tsaUrl       String
  token        Bytes
  genTime      DateTime
  createdAt    DateTime @default(now())

  @@index([anchoredSeq])
  @@index([createdAt])
}
```

- [ ] **Step 2: Add the settings columns.** In the `PlatformSettings` model, add before `updatedAt`:

```prisma
  externalAnchorEnabled Boolean? // opt-in; null/false = anchoring off
  anchorTsaUrl          String? // RFC 3161 TSA endpoint; empty = unset (no bundled default)
  anchorTsaAuth         String? // optional "user:pass" for a TSA behind HTTP Basic; empty = none
```

- [ ] **Step 3: Add the dependency.** Run:

```bash
cd /opt/captivo-access && pnpm add pkijs
```

(`pkijs` pulls in `asn1js` and `pvutils` transitively.)

- [ ] **Step 4: Push schema + regenerate client.** Run:

```bash
cd /opt/captivo-access && npx prisma db push && npx prisma generate
```

Expected: "Your database is now in sync" and "Generated Prisma Client".

- [ ] **Step 5: Verify the client typechecks.** Run:

```bash
cd /opt/captivo-access && pnpm build
```

Expected: BUILD passes (no new code references the models yet; this only proves the client regenerated cleanly).

- [ ] **Step 6: Commit.**

```bash
cd /opt/captivo-access && git add prisma/schema.prisma package.json pnpm-lock.yaml && git commit -m "feat(audit): AuditAnchor model + external-anchor settings columns + pkijs"
```

---

### Task 2: RFC 3161 module (`src/lib/audit/rfc3161.ts`)

**Files:**
- Create: `src/lib/audit/rfc3161.ts`
- Create: `src/lib/audit/rfc3161.test.ts`
- Create: `src/lib/audit/rfc3161.fixtures/README.md`, `token.tsr`, `digest.hex`

**Interfaces:**
- Produces:
  - `buildTimeStampRequest(digest: Buffer): Buffer` — DER TimeStampReq (SHA-256, certReq true).
  - `parseTimeStampResponse(der: Buffer): { token: Buffer; genTime: Date }` — throws `Error` if PKIStatus is not granted/grantedWithMods.
  - `verifyTimeStampToken(token: Buffer, expectedDigest: Buffer): Promise<{ ok: boolean; genTime: Date | null; reason?: string }>` — verifies the CMS signature against the embedded TSA cert and that the token's message imprint equals `expectedDigest`.

- [ ] **Step 1: Generate committed fixtures (one-time).** From a machine with internet, run:

```bash
cd /opt/captivo-access/src/lib/audit/rfc3161.fixtures
printf 'captivo-external-anchor-fixture' > data.bin
openssl ts -query -data data.bin -sha256 -cert -no_nonce -out request.tsq
curl -sS -H "Content-Type: application/timestamp-query" --data-binary @request.tsq https://freetsa.org/tsr -o token.tsr
# Record the exact digest the token attests (SHA-256 of data.bin):
openssl dgst -sha256 -binary data.bin | xxd -p -c 256 > digest.hex
rm request.tsq   # keep only token.tsr + digest.hex + data.bin
```

Write `README.md` documenting: fixture is a real freeTSA.org token over `data.bin`; `digest.hex` is `sha256(data.bin)`; tests assert the token verifies against that digest and fails against any other.

- [ ] **Step 2: Write the failing test.** In `src/lib/audit/rfc3161.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTimeStampRequest, parseTimeStampResponse, verifyTimeStampToken } from "./rfc3161";

const DIR = join(__dirname, "rfc3161.fixtures");
const token = readFileSync(join(DIR, "token.tsr"));
const digest = Buffer.from(readFileSync(join(DIR, "digest.hex"), "utf8").trim(), "hex");

describe("rfc3161", () => {
  it("builds a DER TimeStampReq that starts with a SEQUENCE tag", () => {
    const req = buildTimeStampRequest(digest);
    expect(req.length).toBeGreaterThan(0);
    expect(req[0]).toBe(0x30); // ASN.1 SEQUENCE
  });

  it("parses a granted response into a token + genTime", () => {
    // token.tsr is a bare TimeStampToken (CMS), not a full TimeStampResp, so we
    // verify+read genTime directly here; parseTimeStampResponse is covered by the
    // wrapping test below.
    return verifyTimeStampToken(token, digest).then((r) => {
      expect(r.ok).toBe(true);
      expect(r.genTime).toBeInstanceOf(Date);
    });
  });

  it("verifies the token against the correct digest", async () => {
    const r = await verifyTimeStampToken(token, digest);
    expect(r.ok).toBe(true);
  });

  it("rejects the token against a wrong digest", async () => {
    const wrong = Buffer.alloc(32, 0xff);
    const r = await verifyTimeStampToken(token, wrong);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("imprint_mismatch");
  });
});
```

> Note: `freetsa.org/tsr` returns a full `TimeStampResp`; if your fixture is a full response, keep it as `response.tsr` and add a `parseTimeStampResponse(response)` test asserting `token` is non-empty and `genTime instanceof Date`. Use whichever the fixture actually is and make the test match; do not assert both shapes.

- [ ] **Step 3: Run the test to verify it fails.**

```bash
cd /opt/captivo-access && pnpm test src/lib/audit/rfc3161.test.ts
```

Expected: FAIL — module not found / functions undefined.

- [ ] **Step 4: Implement `src/lib/audit/rfc3161.ts`.**

```ts
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { webcrypto } from "node:crypto";

// pkijs needs a WebCrypto engine; Node's is under node:crypto.
pkijs.setEngine(
  "node",
  new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto }),
);

const SHA256_OID = "2.16.840.1.101.3.4.2.1";

function toBuffer(ab: ArrayBuffer): Buffer {
  return Buffer.from(new Uint8Array(ab));
}

export function buildTimeStampRequest(digest: Buffer): Buffer {
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
      hashedMessage: new asn1js.OctetString({ valueHex: new Uint8Array(digest).buffer }),
    }),
    certReq: true,
  });
  return toBuffer(req.toSchema().toBER(false));
}

// Extracts the TSTInfo from a TimeStampToken (a CMS ContentInfo/SignedData).
function readTstInfo(signed: pkijs.SignedData): pkijs.TSTInfo {
  const eContent = signed.encapContentInfo.eContent;
  if (!eContent) throw new Error("token has no eContent");
  const der = eContent.valueBlock.valueHexView;
  const parsed = asn1js.fromBER(der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength));
  if (parsed.offset === -1) throw new Error("bad TSTInfo DER");
  return new pkijs.TSTInfo({ schema: parsed.result });
}

function contentInfoFromToken(token: Buffer): pkijs.SignedData {
  const asn1 = asn1js.fromBER(new Uint8Array(token).buffer);
  if (asn1.offset === -1) throw new Error("bad token DER");
  const ci = new pkijs.ContentInfo({ schema: asn1.result });
  return new pkijs.SignedData({ schema: ci.content });
}

export function parseTimeStampResponse(der: Buffer): { token: Buffer; genTime: Date } {
  const asn1 = asn1js.fromBER(new Uint8Array(der).buffer);
  if (asn1.offset === -1) throw new Error("bad response DER");
  const resp = new pkijs.TimeStampResp({ schema: asn1.result });
  const status = resp.status.status;
  if (status !== 0 && status !== 1) throw new Error(`TSA did not grant (PKIStatus ${status})`);
  if (!resp.timeStampToken) throw new Error("response has no token");
  const tokenDer = toBuffer(resp.timeStampToken.toSchema().toBER(false));
  const signed = new pkijs.SignedData({ schema: resp.timeStampToken.content });
  const tst = readTstInfo(signed);
  return { token: tokenDer, genTime: tst.genTime };
}

export async function verifyTimeStampToken(
  token: Buffer,
  expectedDigest: Buffer,
): Promise<{ ok: boolean; genTime: Date | null; reason?: string }> {
  let signed: pkijs.SignedData;
  let tst: pkijs.TSTInfo;
  try {
    signed = contentInfoFromToken(token);
    tst = readTstInfo(signed);
  } catch {
    return { ok: false, genTime: null, reason: "parse_error" };
  }
  // 1) message imprint must equal the digest we anchored.
  const imprint = Buffer.from(tst.messageImprint.hashedMessage.valueBlock.valueHexView);
  if (!imprint.equals(expectedDigest)) {
    return { ok: false, genTime: tst.genTime, reason: "imprint_mismatch" };
  }
  // 2) the CMS signature must verify against the embedded TSA certificate.
  let sigOk = false;
  try {
    const res = await signed.verify({ signer: 0, checkChain: false });
    sigOk = res === true || (typeof res === "object" && (res as { signatureVerified?: boolean }).signatureVerified === true);
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, genTime: tst.genTime, reason: "signature_invalid" };
  return { ok: true, genTime: tst.genTime };
}
```

> The `pkijs` API surface can shift between minor versions; if a call fails at runtime, align the property/method names to the installed `pkijs` types (`node_modules/pkijs/build/index.d.ts`). The fixture tests are the source of truth — iterate until they pass.

- [ ] **Step 5: Run the tests to verify they pass.**

```bash
cd /opt/captivo-access && pnpm test src/lib/audit/rfc3161.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/audit/rfc3161.ts src/lib/audit/rfc3161.test.ts src/lib/audit/rfc3161.fixtures && git commit -m "feat(audit): RFC 3161 request build + response parse + token verify"
```

---

### Task 3: Settings layer + save-route validation + settings-form UI

**Files:**
- Modify: `src/lib/settings/platform.ts`
- Modify: `src/app/api/admin/policy/platform/route.ts`
- Modify: `src/app/(app)/admin/policy/platform-settings-form.tsx`

**Interfaces:**
- Consumes: `PlatformSettings` model columns from Task 1.
- Produces:
  - `PlatformSettings` interface gains `externalAnchorEnabled: boolean | null`, `anchorTsaUrl: string | null`, `anchorTsaAuth: string | null`.
  - `resolvedExternalAnchorEnabled(): Promise<boolean>` (default false), `resolvedAnchorTsaUrl(): Promise<string>` (default ""), `resolvedAnchorTsaAuth(): Promise<string>` (default "").
  - Save route rejects `{ externalAnchorEnabled: true, anchorTsaUrl: "" }` with `{ error: "anchor_tsa_required" }` (HTTP 400).

- [ ] **Step 1: Extend `PlatformSettings` interface + EMPTY + get + save.** In `src/lib/settings/platform.ts`:
  - Add to the `PlatformSettings` interface: `externalAnchorEnabled: boolean | null; anchorTsaUrl: string | null; anchorTsaAuth: string | null;`
  - Add the same three keys (all `null`) to `EMPTY`.
  - In `getPlatformSettings`, add to the built `s` object:
    ```ts
    externalAnchorEnabled: c?.externalAnchorEnabled ?? null,
    anchorTsaUrl: c?.anchorTsaUrl ?? null,
    anchorTsaAuth: c?.anchorTsaAuth ?? null,
    ```
  (`savePlatformSettings` already spreads the whole object, so it needs no change.)

- [ ] **Step 2: Add resolvers.** Append to `src/lib/settings/platform.ts`:

```ts
// External anchor (RFC 3161). Opt-in, off by default; no env fallback, no bundled TSA.
export async function resolvedExternalAnchorEnabled(): Promise<boolean> {
  const s = await getPlatformSettings();
  return s.externalAnchorEnabled === true;
}

export async function resolvedAnchorTsaUrl(): Promise<string> {
  const s = await getPlatformSettings();
  return (s.anchorTsaUrl ?? "").trim();
}

export async function resolvedAnchorTsaAuth(): Promise<string> {
  const s = await getPlatformSettings();
  return (s.anchorTsaAuth ?? "").trim();
}
```

- [ ] **Step 3: Validate + persist in the save route.** In `src/app/api/admin/policy/platform/route.ts`, before the `savePlatformSettings(...)` call add:

```ts
  const anchorEnabled = body.externalAnchorEnabled === true;
  const anchorTsaUrl = typeof body.anchorTsaUrl === "string" ? body.anchorTsaUrl.trim() : "";
  const anchorTsaAuth = typeof body.anchorTsaAuth === "string" ? body.anchorTsaAuth.trim() : "";
  if (anchorEnabled && anchorTsaUrl === "") {
    return NextResponse.json({ error: "anchor_tsa_required" }, { status: 400 });
  }
  if (anchorTsaUrl !== "") {
    try {
      const u = new URL(anchorTsaUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    } catch {
      return NextResponse.json({ error: "anchor_tsa_invalid" }, { status: 400 });
    }
  }
```

  Then add these three keys to the `savePlatformSettings({...})` object:

```ts
    externalAnchorEnabled: anchorEnabled,
    anchorTsaUrl: anchorTsaUrl || null,
    anchorTsaAuth: anchorTsaAuth || null,
```

- [ ] **Step 4: Add the UI controls.** In `src/app/(app)/admin/policy/platform-settings-form.tsx`:
  - Add state near the other `useState` calls:
    ```ts
    const [anchorOn, setAnchorOn] = useState(initial.externalAnchorEnabled === true);
    const [anchorUrl, setAnchorUrl] = useState(initial.anchorTsaUrl ?? "");
    const [anchorAuth, setAnchorAuth] = useState(initial.anchorTsaAuth ?? "");
    ```
  - Add these three keys to the `body` in `save()`'s `JSON.stringify`:
    ```ts
    externalAnchorEnabled: anchorOn,
    anchorTsaUrl: anchorUrl,
    anchorTsaAuth: anchorAuth,
    ```
  - Add a new error branch in `save()` after the `invalid_webhook_url` branch:
    ```ts
    } else if (body.error === "anchor_tsa_required") {
      setNotice({ kind: "err", msg: "Enter a TSA URL to enable external anchoring." });
    } else if (body.error === "anchor_tsa_invalid") {
      setNotice({ kind: "err", msg: "The TSA URL must be a valid http(s) URL." });
    ```
  - Add two settings rows at the end of the `<div className="settings">` block (before its closing `</div>`):
    ```tsx
    <div className="setting">
      <div className="setting-main">
        <div className="setting-label">External anchor (RFC 3161)</div>
        <div className="setting-hint">Daily, timestamp the audit-log chain head with a Time-Stamp Authority so history can&apos;t be back-dated even by someone with full database access. Needs the <code>/api/cron/audit-anchor</code> job scheduled. Off by default.</div>
      </div>
      <div className="setting-ctl">
        <label className="switch"><input type="checkbox" checked={anchorOn} onChange={(e) => setAnchorOn(e.target.checked)} /><span className="track" /></label>
      </div>
    </div>

    <div className="setting setting-stack">
      <div className="setting-main">
        <div className="setting-label">Time-Stamp Authority URL</div>
        <div className="setting-hint">Any RFC 3161 TSA — a public one (e.g. <code>https://freetsa.org/tsr</code>), a commercial one, or your own. Optional <code>user:pass</code> if it needs HTTP Basic auth.</div>
      </div>
      <div className="setting-ctl">
        <input type="url" className="input" style={{ width: "100%" }} value={anchorUrl} onChange={(e) => setAnchorUrl(e.target.value)} placeholder="https://freetsa.org/tsr" />
        <input type="text" className="input" style={{ width: "100%", marginTop: ".4rem" }} value={anchorAuth} onChange={(e) => setAnchorAuth(e.target.value)} placeholder="user:pass (optional)" aria-label="TSA basic auth" />
      </div>
    </div>
    ```

- [ ] **Step 5: Verify build + typecheck.**

```bash
cd /opt/captivo-access && pnpm build
```

Expected: BUILD passes.

- [ ] **Step 6: Manually verify the validation.** With the dev server or a quick node check, POST to `/api/admin/policy/platform` with `{externalAnchorEnabled:true, anchorTsaUrl:""}` and confirm HTTP 400 `anchor_tsa_required`; then with a valid URL confirm `{ok:true}`. (No unit test — the route hits auth + DB; the branch logic is exercised here and by the build's typecheck.)

- [ ] **Step 7: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/settings/platform.ts src/app/api/admin/policy/platform/route.ts "src/app/(app)/admin/policy/platform-settings-form.tsx" && git commit -m "feat(audit): external-anchor settings — enable toggle + TSA URL/auth with validation"
```

---

### Task 4: Anchor engine + cron endpoint + heartbeat

**Files:**
- Create: `src/lib/audit/anchor.ts`
- Create: `src/lib/audit/anchor.test.ts`
- Create: `src/app/api/cron/audit-anchor/route.ts`
- Modify: `src/lib/cron/heartbeat.ts`

**Interfaces:**
- Consumes: `buildTimeStampRequest`, `parseTimeStampResponse` (Task 2); `resolvedExternalAnchorEnabled`, `resolvedAnchorTsaUrl`, `resolvedAnchorTsaAuth` (Task 3); `AuditChainState`, `AuditAnchor` (Task 1); `recordCronRun` (existing).
- Produces:
  - `anchorDigest(anchoredSeq: bigint, anchoredHash: string): Buffer`.
  - `shouldAnchor(head: { lastSeq: bigint; lastHash: string }, last: { anchoredSeq: bigint; anchoredHash: string } | null): boolean`.
  - `CronJob` union gains `"audit-anchor"`.

- [ ] **Step 1: Write the failing test.** In `src/lib/audit/anchor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { anchorDigest, shouldAnchor } from "./anchor";

describe("anchorDigest", () => {
  it("is sha256 of `${seq}:${hash}`", () => {
    const d = anchorDigest(42n, "abc123");
    const expected = createHash("sha256").update("42:abc123").digest();
    expect(d.equals(expected)).toBe(true);
  });
});

describe("shouldAnchor", () => {
  it("skips an empty chain (seq 0)", () => {
    expect(shouldAnchor({ lastSeq: 0n, lastHash: "" }, null)).toBe(false);
  });
  it("anchors when no anchor exists yet", () => {
    expect(shouldAnchor({ lastSeq: 5n, lastHash: "h5" }, null)).toBe(true);
  });
  it("skips when the head is unchanged since the last anchor", () => {
    expect(shouldAnchor({ lastSeq: 5n, lastHash: "h5" }, { anchoredSeq: 5n, anchoredHash: "h5" })).toBe(false);
  });
  it("anchors when the head advanced", () => {
    expect(shouldAnchor({ lastSeq: 6n, lastHash: "h6" }, { anchoredSeq: 5n, anchoredHash: "h5" })).toBe(true);
  });
  it("anchors when seq is equal but hash differs (rewrite in place)", () => {
    expect(shouldAnchor({ lastSeq: 5n, lastHash: "hX" }, { anchoredSeq: 5n, anchoredHash: "h5" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
cd /opt/captivo-access && pnpm test src/lib/audit/anchor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure core + network runner in `src/lib/audit/anchor.ts`.**

```ts
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { buildTimeStampRequest, parseTimeStampResponse } from "./rfc3161";
import { resolvedExternalAnchorEnabled, resolvedAnchorTsaUrl, resolvedAnchorTsaAuth } from "@/lib/settings/platform";

export function anchorDigest(anchoredSeq: bigint, anchoredHash: string): Buffer {
  return createHash("sha256").update(`${anchoredSeq}:${anchoredHash}`).digest();
}

export function shouldAnchor(
  head: { lastSeq: bigint; lastHash: string },
  last: { anchoredSeq: bigint; anchoredHash: string } | null,
): boolean {
  if (head.lastSeq <= 0n) return false;
  if (!last) return true;
  return last.anchoredSeq !== head.lastSeq || last.anchoredHash !== head.lastHash;
}

export type AnchorRunResult =
  | { status: "disabled" }
  | { status: "skipped" }
  | { status: "anchored"; anchoredSeq: string; genTime: string }
  | { status: "failed"; error: string };

// runAnchor is fail-open: it returns a result object and never throws, so the
// cron handler always responds 200 and the next run retries.
export async function runAnchor(): Promise<AnchorRunResult> {
  try {
    if (!(await resolvedExternalAnchorEnabled())) return { status: "disabled" };
    const tsaUrl = await resolvedAnchorTsaUrl();
    if (tsaUrl === "") return { status: "disabled" };

    const head = await db.auditChainState.findUnique({
      where: { id: "singleton" },
      select: { lastSeq: true, lastHash: true },
    });
    if (!head) return { status: "skipped" };

    const last = await db.auditAnchor.findFirst({
      orderBy: { anchoredSeq: "desc" },
      select: { anchoredSeq: true, anchoredHash: true },
    });
    if (!shouldAnchor(head, last)) return { status: "skipped" };

    const digest = anchorDigest(head.lastSeq, head.lastHash);
    const req = buildTimeStampRequest(digest);

    const auth = await resolvedAnchorTsaAuth();
    const headers: Record<string, string> = { "Content-Type": "application/timestamp-query" };
    if (auth) headers.Authorization = "Basic " + Buffer.from(auth).toString("base64");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let der: Buffer;
    try {
      const res = await fetch(tsaUrl, { method: "POST", headers, body: new Uint8Array(req), signal: controller.signal });
      if (!res.ok) return { status: "failed", error: `TSA HTTP ${res.status}` };
      der = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }

    const { token, genTime } = parseTimeStampResponse(der);
    await db.auditAnchor.create({
      data: { anchoredSeq: head.lastSeq, anchoredHash: head.lastHash, tsaUrl, token, genTime },
    });
    return { status: "anchored", anchoredSeq: head.lastSeq.toString(), genTime: genTime.toISOString() };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "unknown" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
cd /opt/captivo-access && pnpm test src/lib/audit/anchor.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Extend the `CronJob` union + gate staleness.** In `src/lib/cron/heartbeat.ts`:
  - Change the type to: `export type CronJob = "site-health" | "audit-retention" | "recording-retention" | "audit-anchor";`
  - In `cronHealth`, read the anchor setting alongside `recRetention`:
    ```ts
    const settings = await getPlatformSettings();
    recRetention = settings.recordingRetentionDays ?? 0;
    const anchorOn = settings.externalAnchorEnabled === true;
    ```
    (Replace the existing `recRetention = (await getPlatformSettings()).recordingRetentionDays ?? 0;` line with these three.)
  - In the `else` branch (scheduler healthy), after the recording-retention check add:
    ```ts
    const an = last("audit-anchor");
    if (anchorOn && an && agedOut(an, 26 * 3600_000)) stale.push({ job: "audit-anchor", lastRunAt: an });
    ```

- [ ] **Step 6: Create the cron endpoint `src/app/api/cron/audit-anchor/route.ts`.**

```ts
import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/cron/heartbeat";
import { runAnchor } from "@/lib/audit/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await recordCronRun("audit-anchor");
  const result = await runAnchor();
  // Always 200 — failures are reported in the body and retried next run.
  return NextResponse.json(result);
}
```

- [ ] **Step 7: Verify build + full test suite.**

```bash
cd /opt/captivo-access && pnpm test && pnpm build
```

Expected: all tests PASS, BUILD passes.

- [ ] **Step 8: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/audit/anchor.ts src/lib/audit/anchor.test.ts src/app/api/cron/audit-anchor/route.ts src/lib/cron/heartbeat.ts && git commit -m "feat(audit): daily external-anchor cron (fail-open) + heartbeat"
```

---

### Task 5: Anchor verification API + token download

**Files:**
- Create: `src/lib/audit/anchor-verify.ts`
- Create: `src/lib/audit/anchor-verify.test.ts`
- Create: `src/app/api/admin/audit/anchors/verify/route.ts`
- Create: `src/app/api/admin/audit/anchors/[id]/token/route.ts`

**Interfaces:**
- Consumes: `anchorDigest` (Task 4); `verifyTimeStampToken` (Task 2); `AuditAnchor`, `AuditEvent` (Task 1); `getCurrentUser`, `can` (existing).
- Produces:
  - `type AnchorVerdict = { id: string; anchoredSeq: string; genTime: string | null; ok: boolean; beyondRetention: boolean; reason: string | null }`.
  - `verifyOneAnchor(anchor, chainHashAtSeq, tokenCheck): Promise<AnchorVerdict>` — pure, injectable.

- [ ] **Step 1: Write the failing test.** In `src/lib/audit/anchor-verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verifyOneAnchor, type VerifyDeps } from "./anchor-verify";

const anchor = { id: "a1", anchoredSeq: 5n, anchoredHash: "h5", token: Buffer.from("x"), genTime: new Date("2026-01-01T00:00:00Z") };

const okToken: VerifyDeps["tokenCheck"] = async () => ({ ok: true, genTime: new Date("2026-01-01T00:00:00Z") });
const badToken: VerifyDeps["tokenCheck"] = async () => ({ ok: false, genTime: null, reason: "signature_invalid" });

describe("verifyOneAnchor", () => {
  it("passes when token verifies and the chain still holds the anchored hash", async () => {
    const v = await verifyOneAnchor(anchor, "h5", { tokenCheck: okToken });
    expect(v).toMatchObject({ id: "a1", ok: true, beyondRetention: false, reason: null });
  });

  it("flags a chain mismatch (rewrite) when the event no longer hashes to the anchored value", async () => {
    const v = await verifyOneAnchor(anchor, "DIFFERENT", { tokenCheck: okToken });
    expect(v).toMatchObject({ ok: false, reason: "chain_mismatch" });
  });

  it("reports beyond-retention when the anchored seq is gone", async () => {
    const v = await verifyOneAnchor(anchor, null, { tokenCheck: okToken });
    expect(v).toMatchObject({ ok: true, beyondRetention: true, reason: null });
  });

  it("fails when the token itself is invalid, regardless of the chain", async () => {
    const v = await verifyOneAnchor(anchor, "h5", { tokenCheck: badToken });
    expect(v).toMatchObject({ ok: false, reason: "token_signature_invalid" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
cd /opt/captivo-access && pnpm test src/lib/audit/anchor-verify.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/audit/anchor-verify.ts`.**

```ts
import { anchorDigest } from "./anchor";

export type AnchorInput = {
  id: string;
  anchoredSeq: bigint;
  anchoredHash: string;
  token: Buffer;
  genTime: Date;
};

export type AnchorVerdict = {
  id: string;
  anchoredSeq: string;
  genTime: string | null;
  ok: boolean;
  beyondRetention: boolean;
  reason: string | null;
};

export type VerifyDeps = {
  tokenCheck: (token: Buffer, digest: Buffer) => Promise<{ ok: boolean; genTime: Date | null; reason?: string }>;
};

// verifyOneAnchor is pure given its deps. `chainHashAtSeq` is the hash of the
// AuditEvent currently at anchoredSeq, or null if that seq was retention-purged.
export async function verifyOneAnchor(
  anchor: AnchorInput,
  chainHashAtSeq: string | null,
  deps: VerifyDeps,
): Promise<AnchorVerdict> {
  const digest = anchorDigest(anchor.anchoredSeq, anchor.anchoredHash);
  const tv = await deps.tokenCheck(anchor.token, digest);
  const base = { id: anchor.id, anchoredSeq: anchor.anchoredSeq.toString(), genTime: (tv.genTime ?? anchor.genTime)?.toISOString() ?? null };
  if (!tv.ok) {
    return { ...base, ok: false, beyondRetention: false, reason: `token_${tv.reason ?? "invalid"}` };
  }
  if (chainHashAtSeq === null) {
    return { ...base, ok: true, beyondRetention: true, reason: null };
  }
  if (chainHashAtSeq !== anchor.anchoredHash) {
    return { ...base, ok: false, beyondRetention: false, reason: "chain_mismatch" };
  }
  return { ...base, ok: true, beyondRetention: false, reason: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
cd /opt/captivo-access && pnpm test src/lib/audit/anchor-verify.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Create the verify route `src/app/api/admin/audit/anchors/verify/route.ts`.**

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { verifyTimeStampToken } from "@/lib/audit/rfc3161";
import { verifyOneAnchor } from "@/lib/audit/anchor-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const anchors = await db.auditAnchor.findMany({
    orderBy: { anchoredSeq: "asc" },
    select: { id: true, anchoredSeq: true, anchoredHash: true, token: true, genTime: true },
  });

  const verdicts = [];
  for (const a of anchors) {
    const event = await db.auditEvent.findUnique({ where: { seq: a.anchoredSeq }, select: { hash: true } });
    verdicts.push(
      await verifyOneAnchor(
        { id: a.id, anchoredSeq: a.anchoredSeq, anchoredHash: a.anchoredHash, token: Buffer.from(a.token), genTime: a.genTime },
        event ? event.hash : null,
        { tokenCheck: verifyTimeStampToken },
      ),
    );
  }

  const okCount = verdicts.filter((v) => v.ok).length;
  return NextResponse.json({ total: verdicts.length, ok: okCount, failed: verdicts.length - okCount, verdicts });
}
```

- [ ] **Step 6: Create the token-download route `src/app/api/admin/audit/anchors/[id]/token/route.ts`.**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const anchor = await db.auditAnchor.findUnique({ where: { id }, select: { token: true, anchoredSeq: true } });
  if (!anchor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(Buffer.from(anchor.token), {
    headers: {
      "Content-Type": "application/timestamp-reply",
      "Content-Disposition": `attachment; filename="anchor-seq-${anchor.anchoredSeq}.tsr"`,
    },
  });
}
```

> Note: `params` is a Promise in this Next.js version (App Router async params); the existing dynamic routes in this repo already `await params` — match that. If the local convention is a plain object, drop the `Promise<>` and the `await`.

- [ ] **Step 7: Verify build + full test suite.**

```bash
cd /opt/captivo-access && pnpm test && pnpm build
```

Expected: all PASS, BUILD passes.

- [ ] **Step 8: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/audit/anchor-verify.ts src/lib/audit/anchor-verify.test.ts src/app/api/admin/audit/anchors && git commit -m "feat(audit): verify external anchors against chain + download tokens as .tsr"
```

---

### Task 6: UI panel + audit page wiring + deploy wiring

**Files:**
- Modify: `src/app/(app)/admin/audit/integrity-panel.tsx`
- Modify: `src/app/(app)/admin/audit/page.tsx`
- Modify: `deploy/setup.sh`
- Modify: install docs (the file that lists the other cron jobs — `deploy/README.md` or the repo's install doc; grep for `kvkk-retention`/`audit-retention` cron examples and add the anchor line beside them)

**Interfaces:**
- Consumes: `resolvedExternalAnchorEnabled` (Task 3); `/api/admin/audit/anchors/verify` and `/api/admin/audit/anchors/[id]/token` (Task 5); `AuditAnchor` (Task 1).
- Produces: an `anchor` prop on `<IntegrityPanel>`: `{ enabled: boolean; last: { anchoredSeq: string; genTime: string; tsaUrl: string } | null; count: number }`.

- [ ] **Step 1: Fetch the anchor summary in the audit page.** In `src/app/(app)/admin/audit/page.tsx`, before rendering, add (adjust imports to match the file):

```ts
import { resolvedExternalAnchorEnabled } from "@/lib/settings/platform";
import { db } from "@/lib/db";
// ...
const anchorEnabled = await resolvedExternalAnchorEnabled();
const [anchorCount, lastAnchor] = await Promise.all([
  db.auditAnchor.count(),
  db.auditAnchor.findFirst({ orderBy: { anchoredSeq: "desc" }, select: { anchoredSeq: true, genTime: true, tsaUrl: true } }),
]);
const anchor = {
  enabled: anchorEnabled,
  count: anchorCount,
  last: lastAnchor ? { anchoredSeq: lastAnchor.anchoredSeq.toString(), genTime: lastAnchor.genTime.toISOString(), tsaUrl: lastAnchor.tsaUrl } : null,
};
```

  Then pass it: `<IntegrityPanel anchor={anchor} />`.

- [ ] **Step 2: Extend the panel.** In `src/app/(app)/admin/audit/integrity-panel.tsx`, accept the prop and add anchor status + a "Verify anchors" action + per-anchor download. Add below the existing chain result block, inside the card:

```tsx
type AnchorProp = { enabled: boolean; count: number; last: { anchoredSeq: string; genTime: string; tsaUrl: string } | null };
type AnchorVerdict = { id: string; anchoredSeq: string; genTime: string | null; ok: boolean; beyondRetention: boolean; reason: string | null };

// inside the component:
const [anchorVerdicts, setAnchorVerdicts] = useState<AnchorVerdict[] | null>(null);
const [anchorBusy, setAnchorBusy] = useState(false);

async function verifyAnchors() {
  setAnchorBusy(true);
  setAnchorVerdicts(null);
  try {
    const res = await fetch("/api/admin/audit/anchors/verify", { method: "POST" });
    if (!res.ok) { setError("Anchor verification failed."); return; }
    const body = (await res.json()) as { verdicts: AnchorVerdict[] };
    setAnchorVerdicts(body.verdicts);
  } catch {
    setError("Anchor verification failed.");
  } finally {
    setAnchorBusy(false);
  }
}
```

  And the JSX (after the chain result, before the card closes):

```tsx
{anchor.enabled && (
  <div style={{ marginTop: "1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem" }}>
    <div className="card-head" style={{ padding: 0 }}>
      <div>
        <b>External anchor</b>{" "}
        <span className="sub">
          {anchor.last
            ? `Last: seq ${anchor.last.anchoredSeq} · ${new Date(anchor.last.genTime).toLocaleString()} · ${anchor.count} anchor(s) · ${anchor.last.tsaUrl}`
            : "Enabled, but no anchor recorded yet (runs daily)."}
        </span>
      </div>
      {anchor.count > 0 && (
        <button className="btn sm" onClick={verifyAnchors} disabled={anchorBusy}>
          {anchorBusy ? "Verifying…" : "Verify anchors"}
        </button>
      )}
    </div>
    {anchorVerdicts && (
      <div className="table-wrap" style={{ marginTop: ".6rem" }}>
        <table className="table">
          <thead><tr><th>Seq</th><th>Timestamp</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {anchorVerdicts.map((v) => (
              <tr key={v.id}>
                <td>{v.anchoredSeq}</td>
                <td className="cell-sub">{v.genTime ? new Date(v.genTime).toLocaleString() : "—"}</td>
                <td>
                  {v.ok
                    ? <span className="pill ok">{v.beyondRetention ? "Verified (beyond retention)" : "Verified"}</span>
                    : <span className="pill danger">Failed: {v.reason}</span>}
                </td>
                <td><a className="btn sm ghost" href={`/api/admin/audit/anchors/${v.id}/token`}>Download .tsr</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)}
```

  Update the component signature to `export function IntegrityPanel({ anchor }: { anchor: AnchorProp })`.

- [ ] **Step 3: Verify build.**

```bash
cd /opt/captivo-access && pnpm build
```

Expected: BUILD passes.

- [ ] **Step 4: Schedule the cron in `deploy/setup.sh`.** The crontab is built by `print_cron_lines()` (uses `https://manager.${_d}/api/cron/...`, NOT localhost). Add one line to that function, right after the `audit-retention` line, matching its exact format:

```sh
  printf '%s\n' "36 3 * * * curl -sS -X POST -H \"Authorization: Bearer ${_s}\" https://manager.${_d}/api/cron/audit-anchor >/dev/null 2>&1"
```

  (Uses the block's `_s` = CRON_SECRET and `_d` = ACCESS_DOMAIN. `36 3` keeps it a minute after recording-retention's `35 3` — no clash.)

- [ ] **Step 5: Document the cron.** In the install docs that list the cron endpoints (grep the repo for `api/cron/audit-retention` in `*.md`), add a row/line for `POST /api/cron/audit-anchor` — "daily; timestamps the audit chain head with the configured TSA; no-op unless External anchor is enabled in Policy."

- [ ] **Step 6: Manually smoke-test end to end.** With `externalAnchorEnabled` on and `anchorTsaUrl=https://freetsa.org/tsr` (via the Policy page), call the cron once:

```bash
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/audit-anchor
```

  Expect `{"status":"anchored",...}` (or `"skipped"` if the head hasn't changed). Then open `/admin/audit`, confirm the anchor status line shows, click **Verify anchors** (expect all Verified), and download a `.tsr`. Optionally verify it independently: `openssl ts -reply -in anchor-seq-*.tsr -text`.

- [ ] **Step 7: Commit.**

```bash
cd /opt/captivo-access && git add "src/app/(app)/admin/audit/integrity-panel.tsx" "src/app/(app)/admin/audit/page.tsx" deploy/setup.sh && git add -A -- '*.md' && git commit -m "feat(audit): external-anchor status + verification UI + daily cron wiring"
```

---

## Deployment (after all tasks reviewed)

- `prisma db push` already applied locally in Task 1; on prod, the `migrate` one-shot runs `db push` at deploy.
- Tag a release (`vX.Y.Z`) → `publish.yml` builds images → bump prod `docker-compose.yml` manager (+ run the `migrate` one-shot for the schema change) → `docker compose pull && up`. Data-plane and connector are unchanged, so they stay on their current tags.
- Add the `audit-anchor` cron line to the prod host crontab (daily), matching the other jobs.
- Write English, user-facing GitHub release notes (`gh release edit`) describing the external-anchor feature.

## Self-Review

**Spec coverage:**
- RFC 3161 TSA anchoring → Tasks 2, 4. ✓
- Audit-only scope; no data-plane/connector → respected (no such files touched). ✓
- Opt-in, off by default; no bundled TSA → Task 3 (settings + validation). ✓
- Daily cadence → Task 4 (cron) + Task 6 (schedule). ✓
- `AuditAnchor` data model → Task 1. ✓
- Settings in env→DB→default layer → Task 3. ✓
- Cron fail-open, never blocks ingest → Task 4 (`runAnchor` try/catch, always 200). ✓
- CronRun heartbeat + stale gated on `externalAnchorEnabled` → Task 4 Step 5. ✓
- Verification: token signature + imprint + chain cross-check + beyond-retention → Task 5. ✓
- Downloadable `.tsr` for independent verification → Task 5 (token route) + Task 6 (UI link). ✓
- pkijs isolated in one module → Task 2 (`rfc3161.ts` only). ✓
- Tests in existing `lib/audit/*.test.ts` style → Tasks 2, 4, 5. ✓
- Anchored digest `sha256(seq:hash)` used identically anchor + verify → `anchorDigest` shared by Task 4 and Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. Two explicit "match the local convention" notes (pkijs API drift; async `params`) are guarded with the fallback to apply — acceptable, not placeholders.

**Type consistency:** `anchorDigest(bigint, string): Buffer` defined in Task 4, consumed in Task 5. `verifyTimeStampToken(Buffer, Buffer)` (Task 2) matches `VerifyDeps.tokenCheck` shape (Task 5). `CronJob` union extended once (Task 4) and used in `recordCronRun("audit-anchor")` (Task 4). `AnchorProp`/`AnchorVerdict` shapes consistent between route (Task 5) and UI (Task 6). Settings keys `externalAnchorEnabled`/`anchorTsaUrl`/`anchorTsaAuth` identical across schema (Task 1), settings layer (Task 3), route (Task 3), form (Task 3), resolvers (Task 3), engine (Task 4).
