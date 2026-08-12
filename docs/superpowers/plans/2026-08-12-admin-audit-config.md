# Admin-Action Audit — Config Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record configuration/settings changes (SMTP, SSO, policies, directory, connector ops, recording deletion) in the existing admin-action audit log, without ever writing secret config values.

**Architecture:** Pure reuse of wave-1 infra (`recordAdminAction`, `adminActionLabel`, `AdminAuditEvent`, the audit tab). Add labels + a test, then drop one `recordAdminAction` call after the success path of each config route with **no config-value metadata**.

**Tech Stack:** Next.js API routes, Vitest, TypeScript. No new dependencies, no schema change.

## Global Constraints

- English-only. No Claude signature/trailer in commits.
- **Never write config values into the audit** — each call passes only `action`, a fixed `summary`, `targetType`/`targetId` where an id exists, and `clientIp`. **No `metadata`.**
- Best-effort, after the **success** path only (before the success response); reuse the route's `admin`/`user` actor from `getCurrentUser()`; `clientIp(req.headers) ?? null`.
- No new model/helper/UI, no schema change. Deploy = **manager only**.
- Test runner: `pnpm test -- <path>` (vitest). Build gate: `pnpm build`.
- Reuse: `recordAdminAction` from `@/lib/audit/admin`, `clientIp` from `@/lib/request-ip`, `adminActionLabel`/`LABELS` in `src/lib/audit/admin-actions.ts`.

---

### Task 1: Action labels

**Files:**
- Modify: `src/lib/audit/admin-actions.ts`
- Test: `src/lib/audit/admin-actions.test.ts`

- [ ] **Step 1: Add the failing assertion**

In `src/lib/audit/admin-actions.test.ts`, add to the "known actions" test:

```ts
    expect(adminActionLabel("config.smtp_update")).toBe("SMTP settings updated");
    expect(adminActionLabel("recording.delete")).toBe("Recording deleted");
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/audit/admin-actions.test.ts`
Expected: FAIL (labels fall back to the raw action).

- [ ] **Step 3: Add the labels**

In `src/lib/audit/admin-actions.ts`, add these entries to the `LABELS` map:

```ts
  "config.smtp_update": "SMTP settings updated",
  "config.sso_update": "SSO settings updated",
  "config.platform_update": "Platform settings updated",
  "config.session_policy_update": "Session policy updated",
  "config.log_level_reset": "Connector log level reset",
  "config.directory_update": "Directory settings updated",
  "config.directory_mapping_create": "Directory mapping created",
  "config.directory_mapping_update": "Directory mapping updated",
  "config.directory_mapping_delete": "Directory mapping deleted",
  "config.updates_update": "Update settings updated",
  "connector.egress_update": "Connector egress policy updated",
  "connector.log_level": "Connector log level set",
  "connector.repair": "Connector repaired",
  "recording.delete": "Recording deleted",
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/audit/admin-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/admin-actions.ts src/lib/audit/admin-actions.test.ts
git commit -m "feat(audit): config-wave action labels"
```

---

### Task 2: Instrument settings routes (no target id)

**Files (modify):** `src/app/api/admin/smtp/route.ts`, `src/app/api/admin/sso/route.ts`, `src/app/api/admin/policy/platform/route.ts`, `src/app/api/admin/policy/session/route.ts`, `src/app/api/admin/policy/connector-log-level/reset-all/route.ts`, `src/app/api/admin/directory/route.ts`, `src/app/api/admin/updates/route.ts`

**The pattern** — add `import { recordAdminAction } from "@/lib/audit/admin";` and `import { clientIp } from "@/lib/request-ip";`, then immediately before the success `return NextResponse.json({ ok: true });`, insert. Full example for `smtp/route.ts` (actor var `admin`, request `req`):

```ts
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "config.smtp_update",
    summary: "Updated SMTP settings",
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
```

Apply with these values (each before that handler's success `NextResponse.json`):

| Route | actor var | action | summary | clientIp |
|---|---|---|---|---|
| `smtp/route.ts` | `admin` | `config.smtp_update` | `Updated SMTP settings` | `clientIp(req.headers) ?? null` |
| `sso/route.ts` | **`user`** | `config.sso_update` | `Updated SSO settings` | `clientIp(req.headers) ?? null` |
| `policy/platform/route.ts` | `admin` | `config.platform_update` | `Updated platform settings` | `clientIp(req.headers) ?? null` |
| `policy/session/route.ts` | `admin` | `config.session_policy_update` | `Updated session policy` | `clientIp(req.headers) ?? null` |
| `policy/connector-log-level/reset-all/route.ts` | `admin` | `config.log_level_reset` | `Reset all connector log levels` | `null` (handler is `POST()` with no request — see note) |
| `directory/route.ts` | `admin` | `config.directory_update` | `Updated directory settings` | `clientIp(req.headers) ?? null` |
| `updates/route.ts` | `admin` | `config.updates_update` | `Updated update settings` | `clientIp(req.headers) ?? null` |

> `reset-all/route.ts` is `export async function POST()` with no `req`. Either change its signature to `POST(req: Request)` and use `clientIp(req.headers) ?? null`, or leave the signature and pass `clientIp: null`. Prefer changing the signature for consistency. `sso/route.ts` names the actor `user`, not `admin` — use `{ id: user.id, email: user.email }`.

- [ ] **Step 1: Add imports + calls per the table**
- [ ] **Step 2: Verify it builds** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/smtp src/app/api/admin/sso src/app/api/admin/policy src/app/api/admin/directory/route.ts src/app/api/admin/updates
git commit -m "feat(audit): record settings config changes"
```

---

### Task 3: Instrument target-id routes (mappings, connector ops, recording)

**Files (modify):** `src/app/api/admin/directory/mappings/route.ts`, `src/app/api/admin/directory/mappings/[id]/route.ts`, `src/app/api/admin/connectors/[id]/egress-policy/route.ts`, `src/app/api/admin/connectors/[id]/log-level/route.ts`, `src/app/api/admin/connectors/[id]/repair/route.ts`, `src/app/api/admin/recordings/[id]/route.ts`

Same imports + the same pattern, before each handler's success response. Values (read each handler for its exact success return + the id/actor var in scope — actor is `admin` from `getCurrentUser()`; ids from `await params`):

| Route (handler) | action | target | summary |
|---|---|---|---|
| `directory/mappings/route.ts` (POST) | `config.directory_mapping_create` | mapping / the created mapping's id if returned, else omit | `Created directory mapping` |
| `directory/mappings/[id]/route.ts` (PATCH) | `config.directory_mapping_update` | mapping / `id` | `` `Updated directory mapping ${id}` `` |
| `directory/mappings/[id]/route.ts` (DELETE) | `config.directory_mapping_delete` | mapping / `id` | `` `Deleted directory mapping ${id}` `` |
| `connectors/[id]/egress-policy/route.ts` (POST) | `connector.egress_update` | connector / `id` | `` `Updated egress policy for connector ${id}` `` |
| `connectors/[id]/log-level/route.ts` (POST) | `connector.log_level` | connector / `id` | `` `Set log level for connector ${id}` `` |
| `connectors/[id]/repair/route.ts` (POST) | `connector.repair` | connector / `id` | `` `Repaired connector ${id}` `` |
| `recordings/[id]/route.ts` (DELETE) | `recording.delete` | recording / `id` | `` `Deleted recording ${id}` `` |

> `directory/mappings/[id]/route.ts` DELETE is `DELETE(_req: NextRequest, ...)` — rename `_req` → `req` to read headers. The `mappings/[id]` PATCH and DELETE both `return NextResponse.json({ ok: true })`; insert each call before its own return (the two returns are in separate handlers, so no ambiguity). For `mappings` POST and `repair`, place the call before whatever success `NextResponse.json(...)` the handler ends with.

- [ ] **Step 1: Add imports + calls per the table**
- [ ] **Step 2: Verify it builds** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/directory/mappings src/app/api/admin/connectors src/app/api/admin/recordings
git commit -m "feat(audit): record directory-mapping, connector-op, and recording admin actions"
```

---

### Task 4: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test` → PASS (existing + the extended label test).
- [ ] **Step 2: Build** — Run: `pnpm build` → Compiles.
- [ ] **Step 3: Sanity** — Run: `grep -rl recordAdminAction src/app/api/admin | wc -l` → 27 (14 wave-1 files + 13 config files; the shared `directory/mappings/[id]` counts once).
- [ ] **Step 4: Manual (Gate A, after deploy):** change SMTP settings, session policy, a directory mapping, set a connector's log level, delete a recording → each appears on `/admin/audit?tab=admin` with the right label and **no secret values** in the row; a forbidden attempt records nothing.

---

## Notes for the implementer

- Deploy is **manager only** (no schema/data-plane change) — a separate, user-approved step.
- Never pass config field values as `metadata`; the fixed summaries above are deliberately value-free.
- Read each handler before editing to attach the call to its real success branch; actor is `admin` everywhere except `sso/route.ts` (`user`).
