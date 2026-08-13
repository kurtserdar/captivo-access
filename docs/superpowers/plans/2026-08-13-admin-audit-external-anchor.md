# Admin-Audit External RFC-3161 Anchoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the access chain's external RFC-3161 anchoring to the admin-audit chain, notarizing its head via the same TSA on the same cron.

**Architecture:** A new `AdminAuditAnchor` table mirrors `AuditAnchor`. `runAnchor()` is refactored into a generic `runAnchorFor(target)` with two thin bindings — `runAnchor` (access, unchanged behavior) and `runAdminAnchor` (admin). The one anchor cron runs both. Mirror `admin-anchors/verify` + `admin-anchors/[id]/token` routes reuse the generic `verifyOneAnchor`. The `AdminIntegrityPanel` gains the access panel's anchor UI.

**Tech Stack:** TypeScript / Next.js (App Router), Prisma 7, vitest.

## Global Constraints

- **English only** — code, comments, commit messages (public OSS repo).
- **No Claude signature** in commits.
- **Do NOT change the access anchor path:** `runAnchor()` stays behavior-identical, `AuditAnchor` untouched, `/api/admin/audit/anchors/*` untouched, and `rfc3161.ts` / `anchor-verify.ts` / `shouldAnchor` / `anchorDigest` / the settings resolvers are reused unchanged.
- **Reuse the existing TSA settings** (`externalAnchorEnabled`, `anchorTsaUrl`, `anchorTsaAuth`) — no new settings.
- **Schema change → migrate.** Ships as **v0.42.0** (manager + migrate; no dataplane, no connector).
- Admin chain head lives in `AuditChainState` under `id = "admin-singleton"`; admin rows in `AdminAuditEvent` with `seq` (`BigInt? @unique`).
- No new unit tests (the added code is db-bound plumbing mirroring the already-proven, not-unit-tested `runAnchor`); validated by `pnpm build` + Gate-A. Do not invent a db/fetch mock harness.

---

### Task 1: Schema — `AdminAuditAnchor` + generalized anchoring op

**Files:**
- Modify: `prisma/schema.prisma` (add `AdminAuditAnchor`)
- Modify: `src/lib/audit/anchor.ts` (extract `runAnchorFor`, add `runAdminAnchor`)

**Interfaces:**
- Consumes: existing `anchorDigest`, `shouldAnchor`, `buildTimeStampRequest`, `parseTimeStampResponse`, the settings resolvers, `AnchorRunResult`.
- Produces: `export async function runAdminAnchor(): Promise<AnchorRunResult>`; `runAnchor()` keeps its signature and behavior.

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, after the `AuditAnchor` model, add:

```prisma
model AdminAuditAnchor {
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

- [ ] **Step 2: Regenerate the Prisma client**

Run: `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm db:generate`
Expected: "Generated Prisma Client" — `db.adminAuditAnchor` now exists on the client.

(No local `db push` needed; the prod schema is pushed by the migrate image at deploy.)

- [ ] **Step 3: Refactor `runAnchor` into `runAnchorFor` + add `runAdminAnchor`**

In `src/lib/audit/anchor.ts`, replace the existing `runAnchor` function with the
generalized form below. The body is the current `runAnchor` logic verbatim, with
three points parameterized via `target`: the chain-state id, the "find last
anchor" query, and the "create anchor" call. Everything else (settings gate,
`shouldAnchor`, `anchorDigest`, request build, TSA fetch + 15s timeout, response
parse, fail-open try/catch) is unchanged.

```ts
type AnchorTarget = {
  chainStateId: string; // "singleton" | "admin-singleton"
  findLastAnchor: () => Promise<{ anchoredSeq: bigint; anchoredHash: string } | null>;
  createAnchor: (data: {
    anchoredSeq: bigint; anchoredHash: string; tsaUrl: string; token: Uint8Array; genTime: Date;
  }) => Promise<unknown>;
};

async function runAnchorFor(target: AnchorTarget): Promise<AnchorRunResult> {
  try {
    if (!(await resolvedExternalAnchorEnabled())) return { status: "disabled" };
    const tsaUrl = await resolvedAnchorTsaUrl();
    if (tsaUrl === "") return { status: "disabled" };

    const head = await db.auditChainState.findUnique({
      where: { id: target.chainStateId },
      select: { lastSeq: true, lastHash: true },
    });
    if (!head) return { status: "skipped" };

    const last = await target.findLastAnchor();
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
      const res = await fetch(tsaUrl, {
        method: "POST",
        headers,
        body: new Uint8Array(req),
        signal: controller.signal,
      });
      if (!res.ok) return { status: "failed", error: `TSA HTTP ${res.status}` };
      der = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }

    const { token, genTime } = parseTimeStampResponse(der);
    await target.createAnchor({
      anchoredSeq: head.lastSeq,
      anchoredHash: head.lastHash,
      tsaUrl,
      token: new Uint8Array(token),
      genTime,
    });
    return { status: "anchored", anchoredSeq: head.lastSeq.toString(), genTime: genTime.toISOString() };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function runAnchor(): Promise<AnchorRunResult> {
  return runAnchorFor({
    chainStateId: "singleton",
    findLastAnchor: () =>
      db.auditAnchor.findFirst({ orderBy: { anchoredSeq: "desc" }, select: { anchoredSeq: true, anchoredHash: true } }),
    createAnchor: (data) => db.auditAnchor.create({ data }),
  });
}

export async function runAdminAnchor(): Promise<AnchorRunResult> {
  return runAnchorFor({
    chainStateId: "admin-singleton",
    findLastAnchor: () =>
      db.adminAuditAnchor.findFirst({ orderBy: { anchoredSeq: "desc" }, select: { anchoredSeq: true, anchoredHash: true } }),
    createAnchor: (data) => db.adminAuditAnchor.create({ data }),
  });
}
```

Leave `anchorPreimage`, `anchorDigest`, `shouldAnchor`, and the `AnchorRunResult` type exactly as they are.

- [ ] **Step 4: Verify it builds**

Run: `pnpm build`
Expected: Compiles. (Confirms the refactor typechecks and `db.adminAuditAnchor` resolves.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/audit/anchor.ts
git commit -m "feat(audit): AdminAuditAnchor model + generalized runAnchorFor/runAdminAnchor"
```

---

### Task 2: Cron anchors both chains

**Files:**
- Modify: `src/app/api/cron/audit-anchor/route.ts`

**Interfaces:**
- Consumes: `runAnchor`, `runAdminAnchor` (Task 1).

- [ ] **Step 1: Run both in the cron handler**

In `src/app/api/cron/audit-anchor/route.ts`, add `runAdminAnchor` to the import
and replace the single-run body:

```ts
import { runAnchor, runAdminAnchor } from "@/lib/audit/anchor";
```

```ts
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await recordCronRun("audit-anchor");
  // Always 200 — each run is fail-open and reports its own status; a failure in
  // one chain never blocks the other or the next run.
  const access = await runAnchor();
  const admin = await runAdminAnchor();
  return NextResponse.json({ access, admin });
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build`
Expected: Compiles.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/cron/audit-anchor/route.ts"
git commit -m "feat(audit): anchor cron pins both access and admin chains"
```

---

### Task 3: Admin anchor verify + token routes

**Files:**
- Create: `src/app/api/admin/audit/admin-anchors/verify/route.ts`
- Create: `src/app/api/admin/audit/admin-anchors/[id]/token/route.ts`

**Interfaces:**
- Consumes: `verifyOneAnchor` (`@/lib/audit/anchor-verify`), `verifyTimeStampToken` (`@/lib/audit/rfc3161`), `db.adminAuditAnchor`, `db.adminAuditEvent`.
- Produces: `POST /api/admin/audit/admin-anchors/verify` → `{ total, ok, failed, verdicts }`; `GET /api/admin/audit/admin-anchors/[id]/token` → the raw `.tsr`.

- [ ] **Step 1: The verify route**

Create `src/app/api/admin/audit/admin-anchors/verify/route.ts`:

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

  const anchors = await db.adminAuditAnchor.findMany({
    orderBy: { anchoredSeq: "asc" },
    select: { id: true, anchoredSeq: true, anchoredHash: true, token: true, genTime: true },
  });

  const verdicts = [];
  for (const a of anchors) {
    const event = await db.adminAuditEvent.findUnique({ where: { seq: a.anchoredSeq }, select: { hash: true } });
    verdicts.push(
      await verifyOneAnchor(
        {
          id: a.id,
          anchoredSeq: a.anchoredSeq,
          anchoredHash: a.anchoredHash,
          token: Buffer.from(a.token),
          genTime: a.genTime,
        },
        event ? event.hash : null,
        { tokenCheck: verifyTimeStampToken },
      ),
    );
  }

  const okCount = verdicts.filter((v) => v.ok).length;
  return NextResponse.json({ total: verdicts.length, ok: okCount, failed: verdicts.length - okCount, verdicts });
}
```

- [ ] **Step 2: The token download route**

Create `src/app/api/admin/audit/admin-anchors/[id]/token/route.ts`:

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
  const anchor = await db.adminAuditAnchor.findUnique({ where: { id }, select: { token: true, anchoredSeq: true } });
  if (!anchor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(Buffer.from(anchor.token), {
    headers: {
      "Content-Type": "application/timestamp-reply",
      "Content-Disposition": `attachment; filename="admin-anchor-seq-${anchor.anchoredSeq}.tsr"`,
    },
  });
}
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles; both routes appear in the route list.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/admin/audit/admin-anchors"
git commit -m "feat(audit): admin-chain anchor verify + token routes"
```

---

### Task 4: Extend `AdminIntegrityPanel` with the anchor UI

**Files:**
- Modify: `src/app/(app)/admin/audit/admin-integrity-panel.tsx`
- Modify: `src/app/(app)/admin/audit/page.tsx` (compute + pass the `anchor` prop)

**Interfaces:**
- Consumes: `POST /api/admin/audit/admin-anchors/verify`, `GET /api/admin/audit/admin-anchors/[id]/token` (Task 3); `resolvedExternalAnchorEnabled` (`@/lib/settings/platform`); `db.adminAuditAnchor`.

- [ ] **Step 1: Add the anchor prop + UI to the panel**

Replace the contents of `src/app/(app)/admin/audit/admin-integrity-panel.tsx` with:

```tsx
"use client";
import { useState } from "react";

type Verdict = { ok: boolean; count: number; brokenAtSeq: string | null; reason: string | null } | null;

type AnchorProp = {
  enabled: boolean;
  count: number;
  last: { anchoredSeq: string; genTime: string; tsaUrl: string } | null;
};

type AnchorVerdict = {
  id: string;
  anchoredSeq: string;
  genTime: string | null;
  ok: boolean;
  beyondRetention: boolean;
  reason: string | null;
};

export function AdminIntegrityPanel({ anchor }: { anchor?: AnchorProp }) {
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [busy, setBusy] = useState(false);
  const [anchorVerdicts, setAnchorVerdicts] = useState<AnchorVerdict[] | null>(null);
  const [anchorBusy, setAnchorBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/audit/admin-verify");
      setVerdict((await res.json()) as Verdict);
    } catch {
      setVerdict({ ok: false, count: 0, brokenAtSeq: null, reason: "request_failed" });
    }
    setBusy(false);
  }

  async function verifyAnchors() {
    setAnchorBusy(true);
    setAnchorVerdicts(null);
    try {
      const res = await fetch("/api/admin/audit/admin-anchors/verify", { method: "POST" });
      const body = (await res.json()) as { verdicts: AnchorVerdict[] };
      setAnchorVerdicts(body.verdicts);
    } catch {
      setAnchorVerdicts([]);
    }
    setAnchorBusy(false);
  }

  return (
    <div className="aa-integrity">
      <button type="button" className="btn sm" onClick={verify} disabled={busy}>{busy ? "Verifying…" : "Verify chain"}</button>
      {verdict && (
        verdict.ok
          ? <span className="aa-ok">✓ Chain intact ({verdict.count} record{verdict.count === 1 ? "" : "s"})</span>
          : <span className="aa-bad">✗ Tampering detected{verdict.brokenAtSeq ? ` at #${verdict.brokenAtSeq}` : ""}{verdict.reason ? ` (${verdict.reason})` : ""}</span>
      )}

      {anchor?.enabled && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem", width: "100%" }}>
          <div className="card-head" style={{ marginBottom: 0, paddingBottom: 0, border: "none" }}>
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
                <thead>
                  <tr><th>Seq</th><th>Timestamp</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {anchorVerdicts.map((v) => (
                    <tr key={v.id}>
                      <td>{v.anchoredSeq}</td>
                      <td className="cell-sub">{v.genTime ? new Date(v.genTime).toLocaleString() : "—"}</td>
                      <td>
                        {v.ok ? (
                          <span className="pill ok">{v.beyondRetention ? "Verified (beyond retention)" : "Verified"}</span>
                        ) : (
                          <span className="pill danger">Failed: {v.reason}</span>
                        )}
                      </td>
                      <td>
                        <a className="btn sm ghost" href={`/api/admin/audit/admin-anchors/${v.id}/token`}>Download .tsr</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Compute + pass the anchor prop from the page**

In `src/app/(app)/admin/audit/page.tsx`, the admin branch (where `tab === "admin"`)
currently renders `<AdminIntegrityPanel />`. Before the `return`, compute the
anchor status (mirroring the access branch), then pass it in.

Add these imports at the top if not already present:

```tsx
import { resolvedExternalAnchorEnabled } from "@/lib/settings/platform";
```

(`db` is already imported.) In the `tab === "admin"` block, after
`listAdminAuditEvents(...)` and before building the JSX, add:

```tsx
    const [adminAnchorEnabled, adminAnchorCount, adminLastAnchor] = await Promise.all([
      resolvedExternalAnchorEnabled(),
      db.adminAuditAnchor.count(),
      db.adminAuditAnchor.findFirst({
        orderBy: { anchoredSeq: "desc" },
        select: { anchoredSeq: true, genTime: true, tsaUrl: true },
      }),
    ]);
    const adminAnchor = {
      enabled: adminAnchorEnabled,
      count: adminAnchorCount,
      last: adminLastAnchor
        ? { anchoredSeq: adminLastAnchor.anchoredSeq.toString(), genTime: adminLastAnchor.genTime.toISOString(), tsaUrl: adminLastAnchor.tsaUrl }
        : null,
    };
```

Then change the render from `<AdminIntegrityPanel />` to:

```tsx
        <AdminIntegrityPanel anchor={adminAnchor} />
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/audit/admin-integrity-panel.tsx" "src/app/(app)/admin/audit/page.tsx"
git commit -m "feat(audit): admin-chain external anchor UI in the integrity panel"
```

---

### Task 5: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (existing tests, unchanged count; no new tests per Global Constraints).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles; the two `admin-anchors` routes appear in the route list.
- [ ] **Step 3: Manual (Gate A, after deploy + migrate):**
  1. Ensure external anchoring is enabled and a TSA URL is configured (same setting that drives the access anchor).
  2. `POST /api/cron/audit-anchor` with the `CRON_SECRET` bearer → body `{ access: {...}, admin: { status: "anchored", anchoredSeq, genTime } }` (or `"skipped"` if the admin head has not advanced since a prior anchor).
  3. Admin-actions tab → the **External anchor** status line shows the last admin anchor; **Verify anchors** → all rows `Verified`.
  4. Download a `.tsr` from a row → a file `admin-anchor-seq-<n>.tsr` downloads.
  5. Second cron POST with no new admin events → `admin: { status: "skipped" }`.
  6. The Access tab's anchor section and **Verify anchors** are unchanged and still pass.

---

## Notes for the implementer

- **Never** touch `AuditAnchor`, `runAnchor`'s observable behavior, `/api/admin/audit/anchors/*`, `rfc3161.ts`, or `anchor-verify.ts`. This slice only adds a parallel admin path and generalizes the shared runner internally.
- Deploy is **v0.42.0, manager + migrate**: bump both tags, `docker compose run --rm access-migrate` (confirm "in sync"), then `up -d access-manager`. No dataplane, no connector. Verify `/login` → 200, then run Gate A. The first admin anchor is minted by the first cron POST after deploy (there is no backfill — anchoring is forward-looking).
- `db.adminAuditEvent.findUnique({ where: { seq } })` works because `seq` is `@unique` (nullable uniques are queryable via findUnique).
