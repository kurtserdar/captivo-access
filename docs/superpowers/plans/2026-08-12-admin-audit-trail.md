# Admin-Action Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record who did what, when, for security-critical admin mutations in a separate append-only `AdminAuditEvent` log, shown as an "Admin actions" tab on `/admin/audit`.

**Architecture:** A new Prisma model + a best-effort `recordAdminAction()` helper called from each instrumented route after its success path; a pure action-label map; a list query; and a tab on the audit page. No hash chain (that's a later hardening slice).

**Tech Stack:** Next.js App Router (server components + API routes), Prisma 7 (`db push`), Vitest, TypeScript.

## Global Constraints

- English-only UI copy. No Turkish. No Claude signature/trailer in commits.
- Append-only: the app only inserts + reads `AdminAuditEvent`; no update/delete paths. **No hash chain** this slice.
- Every `recordAdminAction` call is **best-effort** (try/catch, never throws) and placed **after** the mutation's success, before the success response — forbidden/failed requests write nothing.
- Actor `{ id: admin.id, email: admin.email }` from the route's existing `getCurrentUser()`/`requireUser()`; `clientIp(req.headers) ?? null` from `src/lib/request-ip.ts` (`clientIp(headers: Headers): string | undefined`).
- Prisma workflow: this repo uses `db push` (no migrations dir); adding a model is additive. Regenerate the client with `pnpm db:generate` (the generated client at `src/generated/prisma` is gitignored — never commit it). `Prisma` type imports from `@/generated/prisma/client`; Json writes cast to `Prisma.InputJsonValue`.
- Test runner: `pnpm test -- <path>` (vitest). Build gate: `pnpm build`.
- Deploy (separate, user-approved): bump **manager + migrate** images and run `docker compose run --rm access-migrate` (a plain `up -d` does not push the schema).
- Config-change auditing (SMTP/SSO/policy/directory/domain/updates/notifications/recordings) is **out of scope** (2nd wave).

---

### Task 1: AdminAuditEvent model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

Append to `prisma/schema.prisma`:

```prisma
model AdminAuditEvent {
  id         String   @id @default(cuid())
  timestamp  DateTime @default(now())
  actorId    String?
  actorEmail String?
  action     String
  targetType String?
  targetId   String?
  summary    String
  metadata   Json?
  clientIp   String?
  createdAt  DateTime @default(now())

  @@index([timestamp])
  @@index([action, timestamp])
  @@index([targetType, targetId])
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `pnpm db:generate`
Expected: completes; `db.adminAuditEvent` is now available on the client.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(audit): AdminAuditEvent model (append-only admin action log)"
```

---

### Task 2: Helper, label map, query

**Files:**
- Create: `src/lib/audit/admin.ts`, `src/lib/audit/admin-actions.ts`, `src/lib/audit/admin-query.ts`
- Test: `src/lib/audit/admin-actions.test.ts`

**Interfaces:**
- Produces:
  - `recordAdminAction(input): Promise<void>` and `AdminActor` (admin.ts)
  - `adminActionLabel(action: string): string` (admin-actions.ts)
  - `listAdminAuditEvents(filter): Promise<{ rows: AdminAuditRow[]; total: number }>` and `AdminAuditRow` (admin-query.ts)

- [ ] **Step 1: Write the failing test**

`src/lib/audit/admin-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { adminActionLabel } from "./admin-actions";

describe("adminActionLabel", () => {
  it("maps known actions to human labels", () => {
    expect(adminActionLabel("session.terminate")).toBe("Session terminated");
    expect(adminActionLabel("grant.update")).toBe("Grant updated");
    expect(adminActionLabel("resource.vault_update")).toBe("Resource credential updated");
  });
  it("falls back to the raw action for unknown values", () => {
    expect(adminActionLabel("something.new")).toBe("something.new");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/audit/admin-actions.test.ts`
Expected: FAIL — cannot resolve `./admin-actions`.

- [ ] **Step 3: Write the three modules**

`src/lib/audit/admin-actions.ts`:

```ts
const LABELS: Record<string, string> = {
  "grant.create": "Grant created",
  "grant.update": "Grant updated",
  "grant.approve": "Grant approved",
  "grant.deny": "Grant denied",
  "grant.revoke": "Grant revoked",
  "session.terminate": "Session terminated",
  "authsession.revoke": "Auth session revoked",
  "user.update": "User updated",
  "user.delete": "User deleted",
  "invite.create": "Invite created",
  "invite.revoke": "Invite revoked",
  "connector.create": "Connector created",
  "connector.revoke": "Connector revoked",
  "connector.delete": "Connector deleted",
  "resource.create": "Resource created",
  "resource.update": "Resource updated",
  "resource.delete": "Resource deleted",
  "resource.vault_update": "Resource credential updated",
};

export function adminActionLabel(action: string): string {
  return LABELS[action] ?? action;
}
```

`src/lib/audit/admin.ts`:

```ts
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface AdminActor { id: string; email: string | null }

// Records a security-critical admin mutation. Best-effort: a failure to write
// the audit row is logged but never thrown, so it can never break the action.
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
    await db.adminAuditEvent.create({
      data: {
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        summary: input.summary,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
        clientIp: input.clientIp ?? null,
      },
    });
  } catch (e) {
    console.error("recordAdminAction failed:", input.action, e);
  }
}
```

`src/lib/audit/admin-query.ts`:

```ts
import { db } from "@/lib/db";

export interface AdminAuditRow {
  id: string;
  timestamp: Date;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
}

export async function listAdminAuditEvents(filter: { limit: number; offset: number; action?: string }): Promise<{ rows: AdminAuditRow[]; total: number }> {
  const where = filter.action ? { action: filter.action } : {};
  const [rows, total] = await Promise.all([
    db.adminAuditEvent.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: { id: true, timestamp: true, actorEmail: true, action: true, targetType: true, targetId: true, summary: true },
    }),
    db.adminAuditEvent.count({ where }),
  ]);
  return { rows, total };
}
```

- [ ] **Step 4: Run the test + build**

Run: `pnpm test -- src/lib/audit/admin-actions.test.ts` → PASS (2 tests).
Run: `pnpm build` → Compiles (confirms `db.adminAuditEvent` exists from Task 1's generate).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/admin.ts src/lib/audit/admin-actions.ts src/lib/audit/admin-query.ts src/lib/audit/admin-actions.test.ts
git commit -m "feat(audit): recordAdminAction helper + action labels + list query"
```

---

### Task 3: Instrument grants + sessions

**Files (modify):** `src/app/api/admin/grants/route.ts`, `src/app/api/admin/grants/[id]/route.ts`, `src/app/api/admin/grants/[id]/decision/route.ts`, `src/app/api/admin/live/[sessionId]/terminate/route.ts`, `src/app/api/admin/sessions/[id]/route.ts`, `src/app/api/admin/sessions/revoke/route.ts`

**The pattern** (add to each route): import `import { recordAdminAction } from "@/lib/audit/admin";` and `import { clientIp } from "@/lib/request-ip";`, then, **immediately before the success `NextResponse.json(...)`**, insert an `await recordAdminAction({...})` using the route's existing `admin` var and `req`. Example — `grants/route.ts` `POST`, before `return NextResponse.json({ id }, { status: 201 });`:

```ts
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "grant.create",
    targetType: "grant", targetId: id,
    summary: `Created access grant ${id}`,
    metadata: { userId, siteId },
    clientIp: clientIp(req.headers) ?? null,
  });
```

Example — `live/[sessionId]/terminate/route.ts` `POST`, before `return NextResponse.json(result);`:

```ts
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "session.terminate",
    targetType: "session", targetId: sessionId,
    summary: `Terminated session ${sessionId}`,
    clientIp: clientIp(req.headers) ?? null,
  });
```

> `terminate/route.ts` currently names the request `_req` and the user `admin` (from `requireUser()` — it has `.id`/`.email`). Rename `_req` → `req` to read headers.

Apply the same pattern with these values (each inserted after the existing success path; read each handler for its actor var name — `admin` from `getCurrentUser()`/`requireUser()` — and the target id in scope):

| Route (handler) | action | targetType / targetId | summary |
|---|---|---|---|
| `grants/route.ts` DELETE | `grant.revoke` | grant / the `id` being revoked | `` `Revoked access grant ${id}` `` |
| `grants/[id]/route.ts` PATCH | `grant.update` | grant / `id` | `` `Updated access grant ${id}` `` (metadata `{ endsAt }` if changed) |
| `grants/[id]/decision/route.ts` POST | `grant.approve` or `grant.deny` (from the same branch that sets APPROVED/DENIED) | grant / `id` | `` `${approved ? "Approved" : "Denied"} access request ${id}` `` |
| `sessions/[id]/route.ts` DELETE | `authsession.revoke` | session / `id` | `` `Revoked auth session ${id}` `` |
| `sessions/revoke/route.ts` POST | `authsession.revoke` | session / the target user id if present, else omit | `Revoked auth sessions` (+ metadata of the scope) |

- [ ] **Step 1: Add the imports + calls per the table above**
- [ ] **Step 2: Verify it builds** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/grants src/app/api/admin/live src/app/api/admin/sessions
git commit -m "feat(audit): record grant + session admin actions"
```

---

### Task 4: Instrument users + invites + connectors + resources

**Files (modify):** `src/app/api/admin/users/[id]/route.ts`, `src/app/api/admin/invites/route.ts`, `src/app/api/admin/invites/[id]/route.ts`, `src/app/api/admin/connectors/route.ts`, `src/app/api/admin/connectors/[id]/route.ts`, `src/app/api/admin/connectors/[id]/delete/route.ts`, `src/app/api/admin/sites/route.ts`, `src/app/api/admin/sites/[id]/route.ts`, `src/app/api/admin/sites/[id]/vault/route.ts`

Same pattern as Task 3 (imports + a `recordAdminAction` before the success response, using the handler's `admin` var + `req.headers`). Values:

| Route (handler) | action | targetType / targetId | summary |
|---|---|---|---|
| `users/[id]/route.ts` PATCH | `user.update` | user / `id` | `` `Updated user ${id}` `` (metadata: changed fields, e.g. `{ role }` or `{ disabled }`) |
| `users/[id]/route.ts` DELETE | `user.delete` | user / `id` | `` `Deleted user ${id}` `` |
| `invites/route.ts` POST | `invite.create` | invite / new invite id | `` `Created invite ${id}` `` (metadata `{ email, role }` if in scope) |
| `invites/[id]/route.ts` DELETE | `invite.revoke` | invite / `id` | `` `Revoked invite ${id}` `` |
| `connectors/route.ts` POST | `connector.create` | connector / new id (or pairing id) | `Created connector` |
| `connectors/[id]/route.ts` (the revoke handler) | `connector.revoke` | connector / `id` | `` `Revoked connector ${id}` `` |
| `connectors/[id]/delete/route.ts` POST | `connector.delete` | connector / `id` | `` `Deleted connector ${id}` `` |
| `sites/route.ts` POST | `resource.create` | resource / new id | `` `Created resource ${id}` `` |
| `sites/[id]/route.ts` PATCH | `resource.update` | resource / `id` | `` `Updated resource ${id}` `` |
| `sites/[id]/route.ts` DELETE | `resource.delete` | resource / `id` | `` `Deleted resource ${id}` `` |
| `sites/[id]/vault/route.ts` (write handler) | `resource.vault_update` | resource / `id` | `` `Updated vault credential for resource ${id}` `` |

> For each: if the handler destructures the id as `params.id`/`ctx.params`, read it there; if it names the user `user` instead of `admin`, use that var. Only instrument the **success** branch of each handler. If a route's revoke lives under a different method than guessed (e.g. `connectors/[id]` uses DELETE), attach to whichever method performs the revoke — read the handler.

- [ ] **Step 1: Add the imports + calls per the table above**
- [ ] **Step 2: Verify it builds** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/users src/app/api/admin/invites src/app/api/admin/connectors src/app/api/admin/sites
git commit -m "feat(audit): record user, invite, connector, resource admin actions"
```

---

### Task 5: "Admin actions" tab on /admin/audit

**Files:**
- Create: `src/app/(app)/admin/audit/admin-audit-table.tsx`
- Modify: `src/app/(app)/admin/audit/page.tsx`
- Modify: `src/app/globals.css` (a couple `.aa-*` styles if the existing `.table` isn't reused)

**Interfaces:**
- Consumes: `listAdminAuditEvents` (Task 2), `adminActionLabel` (Task 2).

- [ ] **Step 1: The table component**

Create `src/app/(app)/admin/audit/admin-audit-table.tsx`:

```tsx
import { adminActionLabel } from "@/lib/audit/admin-actions";
import { LocalTime } from "@/app/(app)/_shell/local-time";

export interface AdminAuditRowJSON {
  id: string;
  timestamp: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
}

export function AdminAuditTable({ rows }: { rows: AdminAuditRowJSON[] }) {
  if (rows.length === 0) return <div className="empty">No admin actions recorded yet.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="cell-sub"><LocalTime iso={r.timestamp} /></td>
              <td>{r.actorEmail ?? "—"}</td>
              <td><span className="pill">{adminActionLabel(r.action)}</span></td>
              <td className="cell-sub">{r.targetType ?? ""}{r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ""}</td>
              <td>{r.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Add the tab to the audit page**

In `src/app/(app)/admin/audit/page.tsx`:

(a) Accept search params and branch by tab. Change the signature to:
```tsx
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireCapability("read_console");
  const { tab } = await searchParams;
  const adminTab = tab === "admin";
```

(b) Add imports:
```tsx
import Link from "next/link";
import { listAdminAuditEvents } from "@/lib/audit/admin-query";
import { AdminAuditTable, type AdminAuditRowJSON } from "./admin-audit-table";
```

(c) Render a two-link tab switcher above the content (place it right after the page heading):
```tsx
      <div className="audit-tabs">
        <Link href="/admin/audit" className={adminTab ? "audit-tab" : "audit-tab active"}>Access</Link>
        <Link href="/admin/audit?tab=admin" className={adminTab ? "audit-tab active" : "audit-tab"}>Admin actions</Link>
      </div>
```

(d) When `adminTab`, fetch + render the admin table **instead of** the Access content (the existing `AuditTable` + `IntegrityPanel`); guard the existing Access-only data fetches (`listAuditEvents`, anchor queries, users/sites) so they only run when `!adminTab` (wrap them, or early-return an admin branch). Concretely, add near the top (after `adminTab`):
```tsx
  if (adminTab) {
    const { rows } = await listAdminAuditEvents({ limit: 50, offset: 0 });
    const adminRows: AdminAuditRowJSON[] = rows.map((r) => ({
      id: r.id, timestamp: r.timestamp.toISOString(), actorEmail: r.actorEmail,
      action: r.action, targetType: r.targetType, targetId: r.targetId, summary: r.summary,
    }));
    return (
      <main>
        <div className="page-head"><div><div className="page-title-row"><span className="page-icon"><AuditIcon /></span><h1>Audit log</h1></div></div></div>
        <div className="audit-tabs">
          <Link href="/admin/audit" className="audit-tab">Access</Link>
          <Link href="/admin/audit?tab=admin" className="audit-tab active">Admin actions</Link>
        </div>
        <AdminAuditTable rows={adminRows} />
      </main>
    );
  }
```
Then leave the existing Access rendering as-is, but add the same `audit-tabs` switcher (with Access active) just after its page heading so both tabs are reachable. (Match the existing heading markup in the file; the `page-head`/`page-title-row`/`page-icon` structure above mirrors other admin pages — adjust to the file's actual heading.)

- [ ] **Step 3: Styles**

Append to `src/app/globals.css`:
```css
.audit-tabs { display: flex; gap: 6px; margin: 4px 0 16px; }
.audit-tab { padding: 6px 14px; border-radius: 8px; font-size: .86rem; color: var(--muted); text-decoration: none; }
.audit-tab:hover { color: var(--fg); background: var(--surface-hover); }
.audit-tab.active { color: var(--nav-accent); background: var(--nav-active); }
```

- [ ] **Step 4: Verify it builds** — Run: `pnpm build` → Compiles.
- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/audit/admin-audit-table.tsx" "src/app/(app)/admin/audit/page.tsx" src/app/globals.css
git commit -m "feat(audit): Admin actions tab on the audit page"
```

---

### Task 6: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (existing + `admin-actions` test).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Manual (Gate A, after deploy + migrate):**
  1. Extend a grant, terminate a session, revoke a grant, disable a user, revoke an invite, delete a connector, edit a resource → each appears on **/admin/audit?tab=admin** with the right admin/action/target/summary.
  2. A **forbidden** attempt (non-admin) records nothing.
  3. The **Access** tab and its integrity panel are unchanged.
  4. Deleting the target of a past action (e.g. the user) leaves its audit row intact (no FK cascade).

---

## Notes for the implementer

- Deploy (separate, user-approved) requires **manager + migrate** at the new tag and `docker compose run --rm access-migrate` before/with the manager rollout — the new table must exist or the admin tab 500s.
- Instrument only success paths; keep every `recordAdminAction` best-effort. Never let it change the response or throw.
- Read each route before editing: the actor var is `admin` or `user` from `getCurrentUser()`/`requireUser()`; attach the call to the handler/branch that performs the mutation.
