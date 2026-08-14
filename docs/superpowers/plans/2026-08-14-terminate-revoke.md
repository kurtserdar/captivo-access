# Terminate + Revoke — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live-session Terminate action also revoke the vendor's access grant to that resource, so a terminated vendor cannot immediately reconnect.

**Architecture:** Manager-only. The console resolves the active grant for each gateway/isolated live session (as it already does for web) and passes its `grantId` to the Terminate button; the terminate route terminates the session AND revokes that grant, auditing both. No data-plane / broker / schema change.

**Tech Stack:** Next.js/TypeScript.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- GATEWAY + ISOLATED only (they have Terminate); web already has Revoke — leave it.
- No active grant (grantId null) → terminate-only (no revoke), today's behaviour.
- Do not break live watching, recording, sizing, or the web Revoke button.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Terminate route revokes the grant + audits both

**Files:**
- Modify: `src/app/api/admin/live/[sessionId]/terminate/route.ts`

**Interfaces:**
- Consumes: `revokeGrant` from `@/lib/access/grants` (existing).
- Produces: `POST /api/admin/live/:id/terminate` accepts `{ grantId?: string }`; terminates + (if grantId) revokes.

- [ ] **Step 1: Read grantId, revoke, audit**

In `src/app/api/admin/live/[sessionId]/terminate/route.ts`, add the import:

```ts
import { revokeGrant } from "@/lib/access/grants";
```

Replace the handler body's terminate+return with a version that also revokes:

```ts
  const { sessionId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { grantId?: string };
  const grantId = typeof body.grantId === "string" && body.grantId ? body.grantId : null;

  const result = await terminateSession(sessionId);
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "session.terminate",
    targetType: "session", targetId: sessionId,
    summary: grantId ? `Terminated session ${sessionId} and revoked grant ${grantId}` : `Terminated session ${sessionId}`,
    clientIp: clientIp(req.headers) ?? null,
  });
  if (grantId) {
    await revokeGrant(grantId);
    await recordAdminAction({
      actor: { id: admin.id, email: admin.email },
      action: "grant.revoke",
      targetType: "grant", targetId: grantId,
      summary: `Revoked access grant ${grantId} (session terminate)`,
      clientIp: clientIp(req.headers) ?? null,
    });
  }
  return NextResponse.json({ ...result, revoked: !!grantId });
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/live/[sessionId]/terminate/route.ts"
git commit -m "feat(live): terminate also revokes the session's access grant (audited)"
```

---

### Task 2: TerminateButton passes grantId + a both-effects confirm

**Files:**
- Modify: `src/app/(app)/_console/terminate-button.tsx`

**Interfaces:**
- Produces: `TerminateButton({ sessionId, grantId?, vendorLabel?, className? })`.

- [ ] **Step 1: Add props + confirm + body**

Replace `src/app/(app)/_console/terminate-button.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function TerminateButton({ sessionId, grantId, vendorLabel, className }: { sessionId: string; grantId?: string | null; vendorLabel?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  async function handleClick() {
    const msg = grantId
      ? `End this session and revoke ${vendorLabel ?? "the vendor"}'s access to this resource? Their next request will be denied.`
      : "Terminate this session? The user will be disconnected immediately.";
    if (!(await confirm(msg, { danger: true, confirmLabel: grantId ? "Terminate & revoke" : "Terminate" }))) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/live/${sessionId}/terminate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(grantId ? { grantId } : {}),
      });
    } catch {
      /* refresh will reflect reality */
    }
    router.refresh();
  }

  return (
    <>
      {dialog}
      <button type="button" className={className ?? "btn sm danger"} onClick={handleClick} disabled={busy}>
        {busy ? "Terminating…" : "Terminate"}
      </button>
    </>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `pnpm build`
Expected: success (existing call sites still compile — the new props are optional).

```bash
git add "src/app/(app)/_console/terminate-button.tsx"
git commit -m "feat(console): Terminate button revokes the grant with a both-effects confirm"
```

---

### Task 3: Console — resolve grantId for gateway/isolated + pass it

**Files:**
- Modify: `src/lib/console/data.ts`
- Modify: `src/app/(app)/_console/security-console.tsx`

- [ ] **Step 1: Broaden the grant query + add grantId to cards**

In `src/lib/console/data.ts`:

Add `grantId: string | null` to the gateway and isolated `LiveCard` variants:

```ts
  | { kind: "gateway"; sessionId: string; protocol: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number; grantId: string | null }
  | { kind: "isolated"; sessionId: string; host: string; userLabel: string; startedAt: string; recorded: boolean; viewerCount: number; grantId: string | null }
```

Broaden the active-grant query from web-only to every live session (`userIds`/`siteIds` already include gateway + isolated + web):

```ts
    userIds.length
      ? db.accessGrant.findMany({
          where: { status: "ACTIVE", userId: { in: userIds }, siteId: { in: siteIds } },
          select: { id: true, userId: true, siteId: true },
        })
      : Promise.resolve([]),
```

(rename the destructured `webGrants` → `liveGrants` and update the `grantMap` line to use it: `const grantMap = new Map(liveGrants.map((g) => [g.userId + "\x1f" + g.siteId, g.id]));`)

Add `grantId` to the gateway + isolated card maps:

```ts
    recorded: recEnabled && (recMap.get(s.siteId) ?? false), viewerCount: s.viewerCount,
    grantId: grantMap.get(s.userId + "\x1f" + s.siteId) ?? null,
```

(add that `grantId` line to BOTH `gatewayCards` and `isolatedCards`.)

- [ ] **Step 2: Pass grantId + label to the buttons**

In `src/app/(app)/_console/security-console.tsx`, the gateway card's `<TerminateButton sessionId={s.sessionId} className="btn sm danger" />` becomes:

```tsx
                    <TerminateButton sessionId={s.sessionId} grantId={s.grantId} vendorLabel={s.userLabel} className="btn sm danger" />
```

And the isolated card's `<TerminateButton sessionId={s.sessionId} className="btn sm danger" />` becomes the same:

```tsx
                    <TerminateButton sessionId={s.sessionId} grantId={s.grantId} vendorLabel={s.userLabel} className="btn sm danger" />
```

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add src/lib/console/data.ts "src/app/(app)/_console/security-console.tsx"
git commit -m "feat(console): resolve + pass grantId for gateway/isolated terminate"
```

---

### Task 4: Admin live table — same grantId wiring

**Files:**
- Modify: `src/app/(app)/admin/live/page.tsx`
- Modify: `src/app/(app)/admin/live/live-table.tsx`

- [ ] **Step 1: Broaden the grant query + add grantId to rows (page)**

In `src/app/(app)/admin/live/page.tsx`, broaden its active-grant query from `webUserIds`/`webSiteIds` to the full `userIds`/`siteIds` (matching Task 3, so gateway/isolated rows resolve a grant), rename `webGrants`→`liveGrants` and update `grantMap`. Add `grantId: grantMap.get(s.userId + "\x1f" + s.siteId) ?? null,` to the `gatewayRows` and `isolatedRows` maps.

- [ ] **Step 2: LiveRow variants + button (table)**

In `src/app/(app)/admin/live/live-table.tsx`, add `grantId: string | null` to the gateway and isolated `LiveRow` variants. In the gateway row's Terminate button and the isolated row's Terminate button, pass `grantId={r.grantId} vendorLabel={r.userLabel}`:

```tsx
                    {canTerminate && <TerminateButton sessionId={r.sessionId} grantId={r.grantId} vendorLabel={r.userLabel} className="btn sm danger" />}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/(app)/admin/live/page.tsx" "src/app/(app)/admin/live/live-table.tsx"
git commit -m "feat(admin): terminate+revoke wiring in the live sessions table"
```

---

### Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Build green**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 2: Wiring grep**

Run: `grep -rn "revokeGrant" "src/app/api/admin/live/[sessionId]/terminate/route.ts" && grep -rn "grantId" src/lib/console/data.ts "src/app/(app)/admin/live/page.tsx" | head`
Expected: revokeGrant in the terminate route; grantId resolved in both console + admin page.

- [ ] **Step 3: Manual Gate (record for deploy gate)**

Deferred to deploy:
- Start a GATEWAY session, admin clicks Terminate → confirm says "…and revoke…" → session ends AND the vendor's grant is revoked → the vendor cannot reconnect (403, no grant). Audit shows both `session.terminate` + `grant.revoke`.
- Same for an ISOLATED session.
- A session with no active grant (e.g. already revoked) → Terminate still ends the session, no error.
- Web Revoke button unchanged.

---

## Self-Review

**Spec coverage:**
- Terminate route revokes + audits both → Task 1. ✓
- Single Terminate button, both-effects confirm, passes grantId → Task 2. ✓
- Console resolves grantId for gateway/isolated + passes it → Task 3. ✓
- Admin live table same wiring → Task 4. ✓
- GATEWAY + ISOLATED scope; web unchanged; grantId-null → terminate-only → per design. ✓
- Manager-only, no schema/dataplane change. ✓

**Placeholder scan:** none — concrete code throughout.

**Type/name consistency:** `grantId?: string | null` on `TerminateButton` (Task 2) matches `LiveCard`/`LiveRow` gateway+isolated `grantId: string | null` (Tasks 3–4) and the route's `{ grantId?: string }` body (Task 1). `grantMap` keyed `userId + "\x1f" + siteId` consistent across data.ts and admin page. `revokeGrant(id)` matches its definition.
