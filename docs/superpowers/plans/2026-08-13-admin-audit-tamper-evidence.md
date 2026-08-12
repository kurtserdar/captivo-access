# Admin-Audit Tamper-Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hash-chain the AdminAuditEvent log (own lock/head/canonicalization), make `recordAdminAction` a serialized append, backfill existing rows, and add verify + an integrity panel.

**Architecture:** Reuse the access-chain pattern. Generalize the hash primitive, add an admin-specific canonicalization + verifier + lock key + head row (in the existing `AuditChainState` table), convert `recordAdminAction` to a locked serialized append, and expose verify + backfill routes with a panel on the Admin-actions tab.

**Tech Stack:** Prisma 7 (`db push`), Postgres advisory locks, Next.js API routes + React, Vitest, TypeScript, node:crypto.

## Global Constraints

- English-only. No Claude signature/trailer in commits. No new Prisma model — reuse `AuditChainState` (access head `id="singleton"`, admin head `id="admin-singleton"`).
- The `chainHash` refactor must be **byte-identical** to today's `computeHash` (a test pins it) — the access chain + its RFC-3161 anchors must not change.
- `recordAdminAction` stays **best-effort** (try/catch, never throws): a failed audit is a coverage gap, never a chain break.
- Metadata (jsonb, reorders keys on read) is canonicalized via a **key-sorted `stableStringify`**, not `JSON.stringify`.
- External RFC-3161 anchoring of the admin chain is **out of scope**.
- Prisma workflow: `db push` (additive; `seq` nullable so it can be added to existing rows); `pnpm db:generate` after schema edits (generated client gitignored). `Prisma` type from `@/generated/prisma/client`; Json writes cast to `Prisma.InputJsonValue`.
- Test runner: `pnpm test -- <path>`. Build gate: `pnpm build`. Deploy = **manager + migrate**, then run the backfill once.

---

### Task 1: Generalize the hash primitive

**Files:**
- Modify: `src/lib/audit/chain.ts`
- Test: `src/lib/audit/chain.test.ts` (add one case)

**Interfaces:**
- Produces: `chainHash(prevHash: string, canonical: string): string`. `computeHash(prevHash, e)` keeps its signature + output.

- [ ] **Step 1: Add the equivalence pin test**

In `src/lib/audit/chain.test.ts` (create if absent), add:

```ts
import { describe, it, expect } from "vitest";
import { chainHash, computeHash, canonicalize, type ChainableEvent } from "./chain";
import { createHash } from "node:crypto";

const E: ChainableEvent = {
  seq: 5n, timestamp: new Date("2026-08-13T00:00:00Z"), userId: "u", siteId: "s",
  host: "h", method: "GET", path: "/x", status: 200, bytesOut: 10n, decision: "ALLOW",
  reason: null, clientIp: "1.2.3.4", userAgent: "ua",
};

describe("chainHash / computeHash", () => {
  it("chainHash matches raw sha256(prev + \\n + canonical)", () => {
    const canon = "abc";
    expect(chainHash("prev", canon)).toBe(createHash("sha256").update("prev\nabc").digest("hex"));
  });
  it("computeHash is unchanged (= chainHash(prev, canonicalize(e)))", () => {
    expect(computeHash("prev", E)).toBe(chainHash("prev", canonicalize(E)));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm test -- src/lib/audit/chain.test.ts` → FAIL (`chainHash` undefined).

- [ ] **Step 3: Implement**

In `src/lib/audit/chain.ts`, add `chainHash` and refactor `computeHash` to use it:

```ts
export function chainHash(prevHash: string, canonical: string): string {
  return createHash("sha256").update(prevHash + "\n" + canonical).digest("hex");
}

export function computeHash(prevHash: string, e: ChainableEvent): string {
  return chainHash(prevHash, canonicalize(e));
}
```

(Delete the old `computeHash` body; keep everything else — `canonicalize`, `AUDIT_CHAIN_LOCK_KEY`, `GENESIS_PREV_HASH`, `ChainableEvent` — untouched.)

- [ ] **Step 4: Run to verify it passes** — Run: `pnpm test -- src/lib/audit/chain.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/chain.ts src/lib/audit/chain.test.ts
git commit -m "refactor(audit): extract chainHash (byte-identical computeHash)"
```

---

### Task 2: Admin chain — canonicalize, hash, verify

**Files:**
- Create: `src/lib/audit/admin-chain.ts`
- Test: `src/lib/audit/admin-chain.test.ts`

**Interfaces:**
- Consumes: `chainHash`, `GENESIS_PREV_HASH` (chain.ts); `ChainVerifyResult`, `ChainHead` (verify.ts).
- Produces: `stableStringify`, `AdminChainable`, `canonicalizeAdmin`, `computeAdminHash`, `AdminStored`, `verifyAdminChain`, `ADMIN_AUDIT_CHAIN_LOCK_KEY`, `ADMIN_CHAIN_ID`.

- [ ] **Step 1: Write the failing tests**

`src/lib/audit/admin-chain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stableStringify, canonicalizeAdmin, computeAdminHash, verifyAdminChain, type AdminChainable, type AdminStored } from "./admin-chain";

function chainable(seq: bigint, over: Partial<AdminChainable> = {}): AdminChainable {
  return {
    seq, timestamp: new Date("2026-08-13T00:00:00Z"), actorId: "a1", actorEmail: "a@x.co",
    action: "grant.revoke", targetType: "grant", targetId: "g1", summary: "Revoked grant g1",
    metadata: null, clientIp: "1.2.3.4", ...over,
  };
}
function chained(items: AdminChainable[]): AdminStored[] {
  let prev = "";
  return items.map((e) => { const hash = computeAdminHash(prev, e); const row = { ...e, prevHash: prev, hash }; prev = hash; return row; });
}

describe("stableStringify", () => {
  it("sorts keys and is order-independent", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("handles null, arrays, nesting", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]');
  });
});

describe("canonicalizeAdmin", () => {
  it("is stable regardless of metadata key order", () => {
    const a = canonicalizeAdmin(chainable(1n, { metadata: { userId: "u", siteId: "s" } }));
    const b = canonicalizeAdmin(chainable(1n, { metadata: { siteId: "s", userId: "u" } }));
    expect(a).toBe(b);
  });
});

describe("verifyAdminChain", () => {
  it("empty → ok", () => expect(verifyAdminChain([]).ok).toBe(true));
  it("intact chain → ok, head matches", () => {
    const rows = chained([chainable(1n), chainable(2n), chainable(3n)]);
    const head = { lastSeq: 3n, lastHash: rows[2].hash };
    expect(verifyAdminChain(rows, head)).toMatchObject({ ok: true, count: 3, reason: null });
  });
  it("altered field → hash_mismatch", () => {
    const rows = chained([chainable(1n), chainable(2n)]);
    rows[1] = { ...rows[1], summary: "tampered" };
    expect(verifyAdminChain(rows).reason).toBe("hash_mismatch");
  });
  it("interior delete → prev_hash_mismatch", () => {
    const rows = chained([chainable(1n), chainable(2n), chainable(3n)]);
    expect(verifyAdminChain([rows[0], rows[2]]).reason).toBe("prev_hash_mismatch");
  });
  it("tail truncation → head_mismatch", () => {
    const rows = chained([chainable(1n), chainable(2n), chainable(3n)]);
    const head = { lastSeq: 3n, lastHash: rows[2].hash };
    expect(verifyAdminChain([rows[0], rows[1]], head).reason).toBe("head_mismatch");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `pnpm test -- src/lib/audit/admin-chain.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/lib/audit/admin-chain.ts`:

```ts
import { chainHash, GENESIS_PREV_HASH } from "./chain";
import type { ChainVerifyResult, ChainHead } from "./verify";

// Distinct 64-bit advisory-lock key for the admin chain (≠ AUDIT_CHAIN_LOCK_KEY),
// so admin appends serialize on their own lock and never block access appends.
export const ADMIN_AUDIT_CHAIN_LOCK_KEY = 6011971385529861011n;
export const ADMIN_CHAIN_ID = "admin-singleton";

const US = "\x1f";

// Deterministic JSON: keys sorted recursively, so a jsonb column that reorders
// keys on read still hashes identically to what was written.
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export interface AdminChainable {
  seq: bigint;
  timestamp: Date;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  metadata: unknown;
  clientIp: string | null;
}

export type AdminStored = AdminChainable & { prevHash: string; hash: string };

// FROZEN field order. id/createdAt are DB bookkeeping and excluded.
export function canonicalizeAdmin(e: AdminChainable): string {
  return [
    e.seq.toString(),
    e.timestamp.toISOString(),
    e.actorId ?? "",
    e.actorEmail ?? "",
    e.action,
    e.targetType ?? "",
    e.targetId ?? "",
    e.summary,
    stableStringify(e.metadata ?? null),
    e.clientIp ?? "",
  ].join(US);
}

export function computeAdminHash(prevHash: string, e: AdminChainable): string {
  return chainHash(prevHash, canonicalizeAdmin(e));
}

// Mirrors verifyChain (adjacency + hash recompute + tail-truncation via head).
export function verifyAdminChain(events: AdminStored[], expectedHead?: ChainHead): ChainVerifyResult {
  if (events.length === 0) {
    return { ok: true, count: 0, firstSeq: null, lastSeq: null, retentionBoundary: false, brokenAtSeq: null, reason: null };
  }
  const retentionBoundary = events[0].prevHash !== GENESIS_PREV_HASH;
  const firstSeq = events[0].seq.toString();
  const lastSeqStr = events[events.length - 1].seq.toString();
  let prevHash: string | null = null;
  for (const e of events) {
    if (computeAdminHash(e.prevHash, e) !== e.hash) {
      return { ok: false, count: events.length, firstSeq, lastSeq: lastSeqStr, retentionBoundary, brokenAtSeq: e.seq.toString(), reason: "hash_mismatch" };
    }
    if (prevHash !== null && e.prevHash !== prevHash) {
      return { ok: false, count: events.length, firstSeq, lastSeq: lastSeqStr, retentionBoundary, brokenAtSeq: e.seq.toString(), reason: "prev_hash_mismatch" };
    }
    prevHash = e.hash;
  }
  if (expectedHead) {
    const last = events[events.length - 1];
    if (last.seq !== expectedHead.lastSeq || last.hash !== expectedHead.lastHash) {
      return { ok: false, count: events.length, firstSeq, lastSeq: last.seq.toString(), retentionBoundary, brokenAtSeq: last.seq.toString(), reason: "head_mismatch" };
    }
  }
  return { ok: true, count: events.length, firstSeq, lastSeq: lastSeqStr, retentionBoundary, brokenAtSeq: null, reason: null };
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `pnpm test -- src/lib/audit/admin-chain.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/admin-chain.ts src/lib/audit/admin-chain.test.ts
git commit -m "feat(audit): admin chain canonicalize + hash + verify"
```

---

### Task 3: Schema + serialized recordAdminAction

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/audit/admin.ts`

**Interfaces:**
- Consumes: `computeAdminHash`, `ADMIN_AUDIT_CHAIN_LOCK_KEY`, `ADMIN_CHAIN_ID` (Task 2).

- [ ] **Step 1: Add the chain columns**

In `prisma/schema.prisma`, add to `model AdminAuditEvent` (and an index):

```prisma
  seq       BigInt?  @unique
  prevHash  String   @default("")
  hash      String   @default("")
```
Add `@@index([seq])` alongside the existing indexes.

- [ ] **Step 2: Regenerate the client** — Run: `pnpm db:generate` → completes.

- [ ] **Step 3: Convert recordAdminAction to a serialized append**

Replace the body of `recordAdminAction` in `src/lib/audit/admin.ts` (keep the same exported signature + `AdminActor`):

```ts
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { computeAdminHash, ADMIN_AUDIT_CHAIN_LOCK_KEY, ADMIN_CHAIN_ID } from "./admin-chain";

export interface AdminActor { id: string; email: string | null }

export async function recordAdminAction(input: {
  actor: AdminActor;
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  clientIp?: string | null;
}): Promise<void> {
  try {
    const ts = new Date();
    const meta = input.metadata ?? null;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_AUDIT_CHAIN_LOCK_KEY})`;
      const head = await tx.auditChainState.upsert({
        where: { id: ADMIN_CHAIN_ID }, create: { id: ADMIN_CHAIN_ID }, update: {},
        select: { lastSeq: true, lastHash: true },
      });
      const seq = head.lastSeq + 1n;
      const hash = computeAdminHash(head.lastHash, {
        seq, timestamp: ts,
        actorId: input.actor.id, actorEmail: input.actor.email,
        action: input.action, targetType: input.targetType ?? null, targetId: input.targetId ?? null,
        summary: input.summary, metadata: meta, clientIp: input.clientIp ?? null,
      });
      await tx.adminAuditEvent.create({
        data: {
          timestamp: ts,
          actorId: input.actor.id, actorEmail: input.actor.email,
          action: input.action, targetType: input.targetType ?? null, targetId: input.targetId ?? null,
          summary: input.summary,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
          clientIp: input.clientIp ?? null,
          seq, prevHash: head.lastHash, hash,
        },
      });
      await tx.auditChainState.update({ where: { id: ADMIN_CHAIN_ID }, data: { lastSeq: seq, lastHash: hash } });
    });
  } catch (e) {
    console.error("recordAdminAction failed:", input.action, e);
  }
}
```

- [ ] **Step 4: Verify it builds** — Run: `pnpm build` → Compiles.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/audit/admin.ts
git commit -m "feat(audit): chain columns + serialized recordAdminAction append"
```

---

### Task 4: Backfill

**Files:**
- Create: `src/lib/audit/admin-backfill.ts`, `src/app/api/admin/audit/admin-backfill/route.ts`

**Interfaces:**
- Produces: `backfillAdminChain(): Promise<{ backfilled: number }>`.

- [ ] **Step 1: The idempotent backfill**

Create `src/lib/audit/admin-backfill.ts`:

```ts
import { db } from "@/lib/db";
import { computeAdminHash, ADMIN_AUDIT_CHAIN_LOCK_KEY, ADMIN_CHAIN_ID } from "./admin-chain";

// One-time, idempotent: chains every AdminAuditEvent row that has no seq yet,
// in insertion order, continuing from the current admin head. No-op if none.
export async function backfillAdminChain(): Promise<{ backfilled: number }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_AUDIT_CHAIN_LOCK_KEY})`;
    const pending = await tx.adminAuditEvent.findMany({
      where: { seq: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, timestamp: true, actorId: true, actorEmail: true, action: true, targetType: true, targetId: true, summary: true, metadata: true, clientIp: true },
    });
    if (pending.length === 0) return { backfilled: 0 };
    const head = await tx.auditChainState.upsert({
      where: { id: ADMIN_CHAIN_ID }, create: { id: ADMIN_CHAIN_ID }, update: {},
      select: { lastSeq: true, lastHash: true },
    });
    let lastSeq = head.lastSeq;
    let lastHash = head.lastHash;
    for (const r of pending) {
      const seq = lastSeq + 1n;
      const hash = computeAdminHash(lastHash, {
        seq, timestamp: r.timestamp, actorId: r.actorId, actorEmail: r.actorEmail,
        action: r.action, targetType: r.targetType, targetId: r.targetId, summary: r.summary,
        metadata: r.metadata ?? null, clientIp: r.clientIp,
      });
      await tx.adminAuditEvent.update({ where: { id: r.id }, data: { seq, prevHash: lastHash, hash } });
      lastSeq = seq;
      lastHash = hash;
    }
    await tx.auditChainState.update({ where: { id: ADMIN_CHAIN_ID }, data: { lastSeq, lastHash } });
    return { backfilled: pending.length };
  });
}
```

- [ ] **Step 2: The admin-gated route**

Create `src/app/api/admin/audit/admin-backfill/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { backfillAdminChain } from "@/lib/audit/admin-backfill";

export async function POST() {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await backfillAdminChain();
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Verify it builds** — Run: `pnpm build` → Compiles.

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit/admin-backfill.ts "src/app/api/admin/audit/admin-backfill/route.ts"
git commit -m "feat(audit): idempotent admin-chain backfill + route"
```

---

### Task 5: Verify route + integrity panel

**Files:**
- Create: `src/app/api/admin/audit/admin-verify/route.ts`, `src/app/(app)/admin/audit/admin-integrity-panel.tsx`
- Modify: `src/app/(app)/admin/audit/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `verifyAdminChain`, `ADMIN_CHAIN_ID` (Task 2).

- [ ] **Step 1: The verify route**

Create `src/app/api/admin/audit/admin-verify/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { verifyAdminChain, ADMIN_CHAIN_ID, type AdminStored } from "@/lib/audit/admin-chain";

export async function GET() {
  const admin = await requireUser();
  if (!can(admin.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [rows, head] = await Promise.all([
    db.adminAuditEvent.findMany({
      where: { seq: { not: null } },
      orderBy: { seq: "asc" },
      select: { seq: true, timestamp: true, actorId: true, actorEmail: true, action: true, targetType: true, targetId: true, summary: true, metadata: true, clientIp: true, prevHash: true, hash: true },
    }),
    db.auditChainState.findUnique({ where: { id: ADMIN_CHAIN_ID }, select: { lastSeq: true, lastHash: true } }),
  ]);

  const events: AdminStored[] = rows.map((r) => ({
    seq: r.seq as bigint, timestamp: r.timestamp, actorId: r.actorId, actorEmail: r.actorEmail,
    action: r.action, targetType: r.targetType, targetId: r.targetId, summary: r.summary,
    metadata: r.metadata ?? null, clientIp: r.clientIp, prevHash: r.prevHash, hash: r.hash,
  }));

  const result = verifyAdminChain(events, head ?? undefined);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: The panel**

Create `src/app/(app)/admin/audit/admin-integrity-panel.tsx`:

```tsx
"use client";
import { useState } from "react";

type Verdict = { ok: boolean; count: number; brokenAtSeq: string | null; reason: string | null } | null;

export function AdminIntegrityPanel() {
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="aa-integrity">
      <button type="button" className="btn sm" onClick={verify} disabled={busy}>{busy ? "Verifying…" : "Verify chain"}</button>
      {verdict && (
        verdict.ok
          ? <span className="aa-ok">✓ Chain intact ({verdict.count} record{verdict.count === 1 ? "" : "s"})</span>
          : <span className="aa-bad">✗ Tampering detected{verdict.brokenAtSeq ? ` at #${verdict.brokenAtSeq}` : ""}{verdict.reason ? ` (${verdict.reason})` : ""}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the admin tab**

In `src/app/(app)/admin/audit/page.tsx`, add `import { AdminIntegrityPanel } from "./admin-integrity-panel";` and render it in the `tab === "admin"` branch, right after the `<AuditTabs admin />` line and before `<AdminAuditTable …/>`:

```tsx
        <AdminIntegrityPanel />
```

- [ ] **Step 4: Styles**

Append to `src/app/globals.css`:

```css
.aa-integrity { display: flex; align-items: center; gap: 12px; margin: 0 0 16px; }
.aa-ok { color: var(--ok); font-size: .85rem; }
.aa-bad { color: var(--danger); font-size: .85rem; font-weight: 600; }
```

- [ ] **Step 5: Verify it builds** — Run: `pnpm build` → Compiles.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/admin/audit/admin-verify/route.ts" "src/app/(app)/admin/audit/admin-integrity-panel.tsx" "src/app/(app)/admin/audit/page.tsx" src/app/globals.css
git commit -m "feat(audit): admin-chain verify route + integrity panel"
```

---

### Task 6: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (existing + chain + admin-chain tests).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Manual (Gate A, after deploy + migrate + backfill):**
  1. `POST /api/admin/audit/admin-backfill` once → `{ backfilled: N }` for the existing rows; a second call → `{ backfilled: 0 }` (idempotent).
  2. Admin-actions tab → **Verify chain** → ✓ Chain intact (count).
  3. Perform a new admin action → verify again → still intact, count +1.
  4. Directly edit one admin row's `summary` in the DB → verify → ✗ tampering at that seq (`hash_mismatch`).
  5. Delete the newest admin row in the DB → verify → ✗ (`head_mismatch`).
  6. The access-audit tab and its verify/anchor are unchanged.

---

## Notes for the implementer

- Deploy needs **manager + migrate** at the new tag, `docker compose run --rm access-migrate`, then one `POST /api/admin/audit/admin-backfill` — the chain columns must exist and existing rows must be chained or verify reports gaps.
- Do not touch the access chain's `canonicalize`, `AUDIT_CHAIN_LOCK_KEY`, or anchor code — only `chainHash` is extracted, byte-identically.
- `recordAdminAction` stays best-effort: the whole append is inside one try/catch; a lock/DB failure logs and returns without throwing.
