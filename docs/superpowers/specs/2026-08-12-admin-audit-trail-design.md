# Admin-Action Audit Trail — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** Record who did what, when, for security-critical admin mutations — in a **separate** append-only log, surfaced as a tab on `/admin/audit`.

## Problem

No admin mutation is audited today. An admin (or operator) can terminate a session, revoke/extend/approve a grant, disable a user, or delete a connector with no record. The existing `AuditEvent` is the **access/proxy-decision** log — hash-chained with a **frozen 13-field canonical serialization** (`seq, timestamp, userId, siteId, host, method, path, status, bytesOut, decision, reason, clientIp, userAgent`) and an RFC-3161 anchor. Admin actions do not fit that shape (no host/method/path/status/decision), and adding fields would break the frozen hash chain and its anchor. So admin actions get their **own** log.

## Scope

- **In:** a new `AdminAuditEvent` model (append-only, **no hash chain**); a central `recordAdminAction()` helper; instrumentation of the **security-critical subset** of mutations; an "Admin actions" tab on `/admin/audit`; a pure `adminActionLabel` + tests.
- **Out (2nd wave — "config audit"):** SMTP, SSO, policy/platform settings, directory/mappings, custom domain, updates config, notifications read, recording deletion. **Tamper-evidence** (hash-chaining the admin log) is a later hardening slice, mirroring how the access log got its chain after an initial plain version.
- **English-only.** Schema change → **migrate**. Deploy = **manager + migrate** (no data-plane/connector change).

## Model (`prisma/schema.prisma`)

```prisma
model AdminAuditEvent {
  id         String   @id @default(cuid())
  timestamp  DateTime @default(now())
  actorId    String?
  actorEmail String?
  action     String   // dotted, e.g. "grant.update", "session.terminate"
  targetType String?  // "grant" | "session" | "user" | "connector" | "resource" | "invite"
  targetId   String?
  summary    String   // human-readable one-liner
  metadata   Json?    // action-specific details (e.g. { oldEndsAt, newEndsAt })
  clientIp   String?
  createdAt  DateTime @default(now())

  @@index([timestamp])
  @@index([action, timestamp])
  @@index([targetType, targetId])
}
```

Append-only by convention (the app only ever inserts + reads; no update/delete paths). Not FK-linked (a deleted user/target must not cascade the record away).

## Central helper (`src/lib/audit/admin.ts`)

```ts
export interface AdminActor { id: string; email: string | null }
export async function recordAdminAction(input: {
  actor: AdminActor;
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  clientIp?: string | null;
}): Promise<void>;
```

- **Best-effort:** wrapped in try/catch; a failure to write the audit row is logged (`console`) but never throws — it must not break the mutation it records.
- Called **after** the mutation succeeds, inside each route, with `actor = { id: admin.id, email: admin.email }` (from `requireUser()`), `clientIp = clientIp(req.headers) ?? null` (existing `src/lib/request-ip.ts`).

## Instrumented mutations (security-critical subset)

| Route (method) | action | target |
|---|---|---|
| `api/admin/grants/route.ts` (POST) | `grant.create` | grant |
| `api/admin/grants/route.ts` (DELETE `?id=`) | `grant.revoke` | grant |
| `api/admin/grants/[id]/route.ts` (PATCH) | `grant.update` | grant |
| `api/admin/grants/[id]/decision/route.ts` (POST) | `grant.approve` / `grant.deny` (by body decision) | grant |
| `api/admin/live/[sessionId]/terminate/route.ts` (POST) | `session.terminate` | session |
| `api/admin/sessions/[id]/route.ts` (DELETE) | `authsession.revoke` | session |
| `api/admin/sessions/revoke/route.ts` (POST) | `authsession.revoke` | session |
| `api/admin/users/[id]/route.ts` (PATCH) | `user.update` | user |
| `api/admin/users/[id]/route.ts` (DELETE) | `user.delete` | user |
| `api/admin/invites/route.ts` (POST) | `invite.create` | invite |
| `api/admin/invites/[id]/route.ts` (DELETE) | `invite.revoke` | invite |
| `api/admin/connectors/route.ts` (POST) | `connector.create` | connector |
| `api/admin/connectors/[id]/route.ts` (DELETE/PATCH revoke) | `connector.revoke` | connector |
| `api/admin/connectors/[id]/delete/route.ts` (POST) | `connector.delete` | connector |
| `api/admin/sites/route.ts` (POST) | `resource.create` | resource |
| `api/admin/sites/[id]/route.ts` (PATCH) | `resource.update` | resource |
| `api/admin/sites/[id]/route.ts` (DELETE) | `resource.delete` | resource |
| `api/admin/sites/[id]/vault/route.ts` (POST/PUT) | `resource.vault_update` | resource |

Each call passes a short `summary` built from data already in the handler (e.g. `"Extended grant for alice@vendor.co → DC-RDP"`) and useful `metadata` (ids, old/new values). Where a handler branches (grant decision approve vs deny; user update disable vs role-change), pick the action/summary from the same branch that decides the outcome. Instrumentation is added **only after** the existing success path (so failed/forbidden requests write nothing).

## Presentation (`src/lib/audit/admin-actions.ts`, pure + tested)

`adminActionLabel(action: string): string` maps the dotted action to a human label for the table (e.g. `grant.update → "Grant updated"`, `session.terminate → "Session terminated"`); unknown actions fall back to the raw string. Kept pure so it is unit-tested.

## Query + UI

- **`src/lib/audit/admin-query.ts`:** `listAdminAuditEvents(filter: { limit: number; offset: number; action?: string }): Promise<{ rows: AdminAuditRow[]; total: number }>` — `AdminAuditRow = { id, timestamp, actorEmail, action, targetType, targetId, summary }` — ordered `timestamp desc`.
- **`/admin/audit` tab:** the page gains a two-tab switcher driven by `?tab=` — **Access** (default: today's `AuditTable` + `IntegrityPanel`, unchanged) and **Admin actions** (new). When `tab=admin`, render a new `AdminAuditTable` (time · actor · action label · target · summary) with load-more paging like `AuditTable`. `IntegrityPanel` shows only on the Access tab (the admin log isn't chained yet).
- CSV/export and hash-verify are **not** added for the admin log this slice (Access-only).

## Testing

- **Unit** (`vitest`): `src/lib/audit/admin-actions.test.ts` — `adminActionLabel` for a few known actions + unknown fallback.
- **Build gate:** `pnpm build`.
- **Manual (Gate A, after deploy + migrate):** perform each instrumented action (extend a grant, terminate a session, revoke a grant, disable a user, revoke an invite, delete a connector, edit a resource) → each appears on the **Admin actions** tab with correct actor/action/target/summary; a *forbidden* attempt writes nothing; the **Access** tab + integrity panel are unchanged; an audit-write failure (simulated) does not break the underlying action.

## Deploy note

Schema change: bump **manager + migrate** images and run `docker compose run --rm access-migrate` (per the deploy rule — a plain `up -d` does not run migrations).

## Out of scope (backlog)

- Config-change auditing (SMTP/SSO/policy/directory/domain/updates/notifications/recordings) — 2nd wave.
- Tamper-evidence (hash-chain + anchor) for the admin log — hardening slice.
- Retention/CSV/filter parity with the access log.
