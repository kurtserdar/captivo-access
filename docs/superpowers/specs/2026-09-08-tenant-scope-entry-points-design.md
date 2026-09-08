# Tenant-Scope the Request Entry Points — Design Spec

**Date:** 2026-09-08
**Status:** Approved for planning.
**Scope:** Correctness fix for `MULTI_TENANT` mode. Self-host (`MULTI_TENANT` off)
must remain byte-behavior-identical.

## Problem

In multi-tenant mode the `db` proxy (`src/lib/db.ts`) auto-scopes each operation
by setting the Postgres RLS GUC `app.current_tenant` in a per-operation
mini-transaction, resolved from the request host. It does **not** set the
AsyncLocalStorage (ALS) tenant. So `currentTenantId()` (`src/lib/tenant/context.ts`)
returns the sentinel **`"default"`** in any request whose entry point did not
explicitly enter `withTenant` / `withRequestTenant` / `withTenantRoute`.

`currentTenantId()` is read **at argument-construction time**, before the db
operation runs, so the auto-scope GUC cannot help it. Every code path that uses
`currentTenantId()` to build a query filter or a write key is therefore wrong in
multi-tenant mode:

1. **Config singletons** keyed on `tenantId` — SMTP, branding, session policy,
   OIDC/SSO, directory, platform settings, update-check. A tenant admin's saved
   config is written under the real tenant (the insert trigger stamps it from the
   GUC) but **read back** with `where: { tenantId: "default" }` → not found → the
   UI shows empty. Platform-settings resolvers (`resolvedInviteTtlHours`,
   `resolvedRecordingRetentionDays`, clipboard/timezone defaults, …) silently fall
   back to env defaults instead of the tenant's saved values.

2. **Insights** (`src/lib/dashboard/insights.ts`) — `getInsights()` does
   `const tenant = currentTenantId()` then filters raw SQL
   `WHERE "tenantId" = ${tenant}`. With `tenant = "default"` the filter contradicts
   the acme RLS scope → **all-zero**. (This is the reported "insights looks empty /
   only vendor role?" symptom — there is no role filter; the page is simply empty.)

3. **Audit tamper-evidence chain** (`src/lib/audit/chain-key.ts`,
   `src/lib/audit/append.ts`) — `chainKey()` and the chain-head upsert use
   `tenantId: currentTenantId()`. The **access** chain head is created correctly by
   the already-wrapped `/api/internal/audit/log` route (tenant = real). But
   **unwrapped** appenders — `/api/gateway/[siteId]/consent`, `/api/admin/live/.../control`,
   `/api/admin/recordings/[id]` (delete) — upsert the head with `where:{tenantId:"default"}`:
   not found under the tenant's RLS scope → `create({tenantId:"default"})` → the
   trigger stamps the real tenant → **unique collision** with the existing
   `(tenant, scope)` head → the append **throws**. In multi-tenant mode a
   gateway-consent / admin-action audit record fails from the second event onward.
   This is a security-critical integrity break, not just a cosmetic gap.

### Root cause (confirmed)

Auto-scope establishes the **RLS GUC** but not the **ALS tenant**. The
request-scoping slice chose "auto-scope, don't wrap browser entry points," which
is sufficient for RLS-filtered reads/writes but not for code that reads
`currentTenantId()` directly. The `(app)` console pages and `/api/admin/**`
handlers are entirely unwrapped; a handful of other authenticated, host-resolvable
routes (notably `/api/gateway/[siteId]/consent`, `/api/branding/splash`) are too.

## Goal

Establish and enforce one invariant:

> In `MULTI_TENANT` mode, every authenticated request entry point that is served
> on a tenant host and performs tenant-scoped DB work runs inside the request's
> tenant scope — `withRequestTenant` for RSC renders, `withTenantRoute` for route
> handlers.

With the ALS tenant set for the whole request, `currentTenantId()` returns the
real tenant at argument-construction time, and **all existing code works unchanged**
(no query rewrites, no touching the audit/insights/config logic). Self-host is
unaffected: `withRequestTenant`/`withTenantRoute` are pass-through when the flag is
off, leaving `currentTenantId()` == `"default"` exactly as today.

## Non-goals

- No change to RLS, the `db` auto-scope proxy, the SECURITY DEFINER resolvers, or
  the tenant-resolution logic.
- No rewrite of config/insights/audit query shapes.
- No change to non-request contexts (cron) — they already fan out per tenant via
  `forEachTenant` (`src/lib/cron/for-each-tenant.ts`) with explicit `withTenant`.
- Recording default-on is **deployment config** (SaaS `.env`), not part of this
  code change — tracked separately (see §6).

## Existing wrappers (reused verbatim, `src/lib/tenant/request.ts`)

- `withRequestTenant<T>(fn: () => Promise<T>): Promise<T>` — RSC bodies. Flag off →
  `fn()`. Flag on → resolve host tenant, `notFound()` if unresolvable, else
  `withTenant(tenantId, fn)`.
- `withTenantRoute<A extends unknown[]>(handler): (...a) => Promise<Response>` —
  route handlers. Flag off → pass-through. Flag on → resolve host tenant, `404`
  `unknown_tenant` if unresolvable, else `withTenant`.

Both resolve the tenant from the request host via `resolveRequestTenant()`
(`slug` → `resolve_tenant_by_slug`), which is memoized per request (React `cache()`),
so wrapping adds no meaningful per-request cost.

## Design

### 1. RSC renders — `(app)` and `(portal)`

Each **server** `page.tsx` / `layout.tsx` wraps its body:

```tsx
export default async function Page(props) {
  return withRequestTenant(async () => {
    // ... existing body verbatim ...
  });
}
```

Notes:
- Layouts and pages are **independent** React renders; a wrapped layout does not
  enclose the page render. Each wraps its own body. Both `(app)/layout.tsx` and
  `(portal)/layout.tsx` call `requireUser()` (DB) → both wrap.
- `"use client"` files are exempt (no server-side DB work).
- Wrapping is uniform across the route group (approved), including pages that only
  do RLS-scoped reads — the uniform invariant is the point; the cost is negligible
  and it future-proofs any later `currentTenantId()` use.

### 2. Route handlers — `/api/admin/**` and the other host-resolvable tenant routes

Each exported method handler goes through `withTenantRoute`:

```ts
export const POST = withTenantRoute(async (req, ctx) => {
  // ... existing handler body verbatim ...
});
```

- Every method a file exports (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) is wrapped —
  partial wrapping is a bug the structural test (below) rejects.
- Handler signatures (`req`, `{ params }`) pass through `withTenantRoute`'s
  variadic generic unchanged.
- Files already wrapped (e.g. `/api/access/my-grants`) need no change and pass the
  test as-is.

### 3. Included vs exempt set (the enforced boundary)

**Included (must be wrapped):**
- `src/app/(app)/**/{page,layout}.tsx` (server components)
- `src/app/(portal)/**/{page,layout}.tsx` (server components)
- `src/app/api/admin/**/route.ts`
- Other authenticated, **host-resolvable**, tenant-scoped route handlers:
  `src/app/api/access/**`, `src/app/api/branding/splash/route.ts`,
  `src/app/api/gateway/[siteId]/**`, `src/app/api/isolated/files/**`,
  `src/app/api/passkeys/[id]/route.ts`, `src/app/api/portal/history/route.ts`,
  `src/app/api/settings/**`, `src/app/api/sites/[id]/logo/route.ts`.
  (`/api/gateway/[siteId]/consent` and `/api/branding/splash` are the
  correctness-critical ones — audit chain and tenant splash respectively.)

**Exempt (must NOT be wrapped — resolve tenant by a non-host mechanism or are
tenant-agnostic), each with a documented reason in the test allowlist:**
- `src/app/api/internal/**` — dataplane calls; tenant resolved from a
  dataplane-supplied identifier (already `withTenantFrom` + `requireDataplaneSecret`).
- `src/app/api/platform/**` — platform tenant; own scope / `PLATFORM_TENANT_ID`.
- `src/app/api/cron/**` — no request host; fan out per tenant via `forEachTenant`.
- `src/app/api/auth/**` — registration/login; already wrapped where needed and/or
  resolve tenant by token/host in their own flow.
- `src/app/api/connector/enroll/route.ts` — connector hits the tunnel host with a
  pairing token; tenant resolved via the pairing-token SECURITY DEFINER resolver,
  not the host. Host-based wrapping would 404 it.
- `src/app/api/recovery/**` — pre-session account recovery; resolves its subject by
  token/email, reviewed individually during implementation.
- `src/app/api/health/route.ts` — tenant-agnostic liveness.

The plan must classify **every** `route.ts` and RSC entry file as included or
exempt; a file in neither list is a plan gap.

### 4. Structural regression test (the anti-fragility guarantee)

A vitest test (`src/lib/tenant/entry-point-scope.test.ts`) scans the repo and
enforces the invariant so a future unwrapped entry point is a **test failure**, not
a production bug:

- Enumerate the included RSC files; skip `"use client"` files; assert each
  references `withRequestTenant`.
- Enumerate the included `route.ts` files; assert there is **no bare**
  `export (async function|const) (GET|POST|PUT|PATCH|DELETE)` that is not produced
  by `withTenantRoute(` — i.e. every method export is wrapped.
- The exempt set is an explicit, commented allowlist in the test; adding a new
  route under an included path with no wrapper fails the test; exempting something
  requires adding it (with a reason) to the allowlist.

This is a static content/AST-lite scan (no DB, no server) — fast and deterministic.

### 5. Functional tests (prove the fix, multi-tenant mode)

Integration tests that run with `MULTI_TENANT` on (the existing multi-tenant test
harness / RLS bootstrap), each under a real tenant request scope:

- **Audit chain (critical):** invoke the gateway-consent append path twice for one
  tenant → no unique collision, chain head belongs to that tenant, events link
  (seq/prevHash intact). Before the fix this throws on the second append.
- **Config singleton round-trip:** upsert a tenant's SMTP (or branding) config,
  then read it back in a fresh request scope → the saved values are returned (not
  empty / not the `"default"` tenant's row).
- **Insights:** with audit events present for a tenant, `getInsights()` under that
  tenant's request scope returns non-zero counts scoped to that tenant.
- **Isolation:** a second tenant sees none of the first tenant's config/audit.

### 6. Self-host regression

- Full suite + build green with `MULTI_TENANT` off.
- `withRequestTenant`/`withTenantRoute` are pass-through when the flag is off, so
  wrapped pages/handlers behave exactly as before (`currentTenantId()` ==
  `"default"`, single implicit tenant). No query, response-shape, or audit-chain
  behavior changes on self-host.

### 7. Recording default (separate, deployment config)

Recording is a product default that should be on for every tenant, not a
tenant-admin chore. It is gated by the global capability flag `RECORDING_ENABLED`
(`src/lib/recording/enabled.ts`); per-resource `recordSessions` is then chosen in
the resource form. This is enabled by setting `RECORDING_ENABLED=1` in the SaaS
deployment `.env` (verify the recording storage/volume is present) and redeploying
— **not** a code change in this spec, and it does not affect self-host. Handled at
deploy time, with explicit deploy approval as usual.

## Rollout

1. Implement wrapping + structural test + functional tests (this plan).
2. Full suite green both flag states; build green.
3. Release (next minor, lockstep) → SaaS redeploy (explicit approval) → set
   `RECORDING_ENABLED=1` in the SaaS `.env` at the same redeploy.
4. Verify on the live tenant: insights shows data, a config singleton round-trips,
   a gateway-consent action records audit without error.

## Risks / notes

- **Missed entry point** → the structural test is the backstop; the included/exempt
  classification must be exhaustive.
- **Wrapping a non-host-resolvable endpoint** (e.g. connector enroll) would 404 it
  in cloud — hence the explicit exempt list; each exemption carries a reason.
- **Double-wrapping** is harmless (already-wrapped files just pass the test) but the
  plan should not re-wrap them.
- **Client components** must not import server-only `withRequestTenant`; the test
  skips `"use client"` files and the plan verifies each included page is a server
  component.

## Global constraints

- English only in the repo (code, comments, console/UI); no Claude attribution in
  commits/PRs; proper Turkish only in user-facing chat.
- `MULTI_TENANT` off ⇒ self-host byte-behavior preserving.
- Cross-tenant / no-scope resolution only via SECURITY DEFINER resolvers.
- Deploy and release-note steps are separate standing gates requiring explicit
  user approval; do not auto-run them.
