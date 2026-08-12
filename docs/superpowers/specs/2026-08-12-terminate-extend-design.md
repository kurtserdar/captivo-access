# Terminate & Extend Actions — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** Make the security console actionable — add two operator actions the #2a design surfaces: **Terminate** a live gateway session and **Extend** an access grant.

## Problem

The console shows live sessions and expiring grants but can't act on them. `/admin/live` has **Watch** only — no way to kill a live gateway session. Grants have create/revoke/edit but no quick **Extend** from where you notice one expiring. This slice adds both.

## Scope

- **In:** Terminate a live session (data-plane close hook + internal endpoint + manager route + admin-only UI with confirm); Extend a grant (quick +1h/+1d/+7d over the existing grant-update endpoint + UI); a pure `nextEndsAt` helper (tested).
- **Out (deferred):** **Auditing admin actions.** Discovered during design: the codebase does not audit *any* admin mutation (grant revoke/decision/edit write no `AuditEvent`; the `AuditEvent` chain is the access/proxy-decision log). Auditing terminate/extend alone would be inconsistent and needs an admin-action-audit design of its own — that becomes a separate backlog slice covering all admin mutations, not just these two.
- **Terminate is admin-only** (`can(role, "configure")`); **Extend** uses the existing admin-only grant-update endpoint. Auditors never see either action.
- **English-only. No schema change.** Deploy touches **manager + data-plane** images (no connector change).

## Terminate a live session

**Data-plane (Go):**
- `dataplane/sessionhub.go`: `liveSession` gains a `closer func()` field (mutex-guarded). `SessionHub` gains `SetCloser(id string, fn func())` and `Terminate(id string) bool` (runs the closer under lock if the session exists; returns whether it was found).
- `dataplane/guactunnel.go`: right after `ls := hub.Register(...)`, register the closer: `hub.SetCloser(sessionID, func() { _ = guac.Close() })`. Closing the guacd connection makes `readRawInstruction` error → the relay goroutines exit → `<-errc` returns → the existing `defer c.CloseNow()` (browser WS) + `defer hub.Remove(sessionID)` tear the session down. No new teardown path.
- `dataplane/main.go`: new internal handler `POST /sessions/terminate` (same `x-dataplane-secret` gate as `/kick`), body `{ "sessionId": string }` → `hub.Terminate(sessionId)` → `{ ok: true, found: <bool> }`.

**Manager:**
- `src/lib/dataplane/client.ts`: `terminateSession(sessionId: string): Promise<{ ok: boolean; found: boolean }>` — POST to `${BASE()}/sessions/terminate` with `authHeaders()` + body; fails soft to `{ ok: false, found: false }` on error (mirrors `listActiveSessions`).
- `src/app/api/admin/live/[id]/terminate/route.ts`: `POST` — `requireCapability("configure")`, `await terminateSession(id)`, return the result as JSON. (`id` = sessionId.)

**UI:**
- `src/app/(app)/admin/live/terminate-button.tsx` (new, client): `TerminateButton({ sessionId })` — `useConfirm()` → `confirm("Terminate this session? The user will be disconnected immediately.", { danger: true, confirmLabel: "Terminate" })`; on confirm, `POST /api/admin/live/${sessionId}/terminate`, then `router.refresh()`.
- Rendered on the **console live cards** (the home console is admin-only, so always shown there) and in the **/admin/live** table **only when** `can(role, "configure")` (pass a `canTerminate` boolean from the page; auditors/operators viewing `/admin/live` don't get the button).

## Extend a grant

The backend already exists: `PATCH /api/admin/grants/[id]` (admin-only) updates `endsAt`, validated by `grantEndsAtError` + `grantCapError` (policy cap `resolvedMaxGrantDays()`). Extend is a one-click convenience over it.

- `src/lib/console/extend.ts` (new, pure, tested): `EXTEND_OPTIONS = [{label:"+1h",hours:1},{label:"+1d",hours:24},{label:"+7d",hours:168}]` and `nextEndsAt(currentEndISO: string | null, hours: number, now: Date): string` → ISO of `max(now, currentEnd) + hours` (extends from whichever is later; from `now` when already past or when there is no end).
- `src/app/(app)/_console/extend-button.tsx` (new, client): `ExtendButton({ grantId, endsAt })` — a small menu of the three options; on click computes `nextEndsAt(endsAt, hours, new Date())` and `PATCH /api/admin/grants/${grantId}` with `{ endsAt }`; on success `router.refresh()`; on the endpoint's cap error (`400`), surface a brief inline message ("Exceeds the maximum grant length"). Rendered on the console **Expiring soon** rows. (Arbitrary extension stays available via the existing **Edit** on `/admin/grants`.)

## Data flow

```
Terminate: console/live [Terminate] → confirm → POST /api/admin/live/{id}/terminate
  → requireCapability(configure) → terminateSession(id) → data-plane /sessions/terminate
  → hub.Terminate → closer() closes guacd conn → relay goroutines exit → session removed → router.refresh
Extend: console Expiring [+1d] → nextEndsAt(endsAt,24,now) → PATCH /api/admin/grants/{id}{endsAt}
  → (existing) cap+window validation → grant.endsAt updated → router.refresh
```

## Error handling

- Terminate on an already-gone session → `found:false`, still `ok`-shaped; UI refreshes (the card disappears). Data-plane unreachable → `ok:false`; the button shows a brief "Couldn't terminate" and refreshes.
- Extend beyond the policy cap → the existing endpoint returns `400`; the button shows the inline cap message and does not refresh.

## Testing

- **Unit** (`vitest`): `src/lib/console/extend.test.ts` — `nextEndsAt` extends from a future end, from `now` when the end is already past, and from `now` when `endsAt` is null; each of the three increments.
- **Go:** a `sessionhub_test.go` case for `SetCloser`/`Terminate` (closer runs once, `Terminate` returns false for an unknown id) if the package already has tests; otherwise covered by the manual gate.
- **Build gate:** `pnpm build` (manager) + `go build ./...` (data-plane).
- **Manual (Gate A, live):** open a gateway session; from the console/`/admin/live`, Terminate it → the browser session drops and the card disappears; a non-admin viewing `/admin/live` sees no Terminate button; on the console, Extend an expiring grant by +1d → its countdown jumps forward; extending past the policy cap shows the cap message.

## Out of scope (backlog)

- Auditing admin actions (terminate/extend/revoke/decision/edit) — a separate, codebase-wide slice.
- Terminate/Extend for operators (kept admin-only here).
- Portal Requests/History; gateway file-transfer audit trail.
