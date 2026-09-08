# Tenant-Scope the Request Entry Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `MULTI_TENANT` mode, make every authenticated, host-resolvable request entry point run inside the request's tenant scope, so `currentTenantId()` is correct everywhere and the config/insights/audit code works unchanged. Self-host stays byte-behavior-identical.

**Architecture:** Wrap each `(app)`/`(portal)` server RSC render body in the existing `withRequestTenant`, and each `/api/admin/**` + other host-resolvable tenant route handler in the existing `withTenantRoute` (both pass-through when the flag is off). A structural regression test enforces the invariant so a future unwrapped entry point fails the test rather than shipping. No query/logic rewrites.

**Tech Stack:** Next.js App Router (RSC + route handlers), TypeScript, Prisma, Postgres RLS, vitest. Spec: `docs/superpowers/specs/2026-09-08-tenant-scope-entry-points-design.md`.

## Global Constraints

- English only in the repo (code, comments, console/UI strings). No Claude attribution in commits/PRs.
- `MULTI_TENANT` off ⇒ self-host byte-behavior preserving. `withRequestTenant`/`withTenantRoute` are pass-through with the flag off; wrapping must not change self-host behavior, response shapes, or the audit chain.
- Reuse the existing wrappers in `src/lib/tenant/request.ts` verbatim — do not modify them, the `db` proxy, RLS, or the SECURITY DEFINER resolvers.
- Cross-tenant / no-scope resolution only via the existing SECURITY DEFINER resolvers.
- Deploy and release-note steps are separate standing gates requiring explicit user approval — this plan does not deploy or tag.

## The wrapping idioms (apply verbatim)

**RSC page (`export default`):**
```tsx
// before
export default async function FooPage(props: Props) {
  /* body */
}
// after
import { withRequestTenant } from "@/lib/tenant/request";
export default async function FooPage(props: Props) {
  return withRequestTenant(async () => {
    /* body verbatim */
  });
}
```
`redirect()` / `notFound()` thrown inside the body propagate through `withRequestTenant` unchanged. Capture `props`/`await params` inside the callback.

**RSC layout:** identical, wrapping the layout body; keep `children` in scope:
```tsx
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return withRequestTenant(async () => { /* body verbatim, returns JSX using children */ });
}
```

**Route handler (per method):**
```ts
// before
export async function POST(req: NextRequest) { /* body */ }
// after
import { withTenantRoute } from "@/lib/tenant/request";
export const POST = withTenantRoute(async (req: NextRequest) => { /* body verbatim */ });
```
Wrap **every** exported method (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`). Preserve the exact parameter list (including `{ params }: { params: Promise<...> }`). Files that already use `withTenantRoute` (e.g. `src/app/api/access/my-grants/route.ts`) are left as-is.

**`"use client"` files are never wrapped** (no server DB work) — they are exempt.

---

### Task 1: Structural scanner + enforce RSC wrapping across `(app)` and `(portal)`

**Files:**
- Create: `src/lib/tenant/entry-point-scope.ts` (pure classification helpers)
- Create: `src/lib/tenant/entry-point-scope.test.ts` (unit tests on string samples + repo-wide RSC assertion)
- Modify: every server `page.tsx`/`layout.tsx` under `src/app/(app)/` and `src/app/(portal)/` (wrap body in `withRequestTenant`)

**Interfaces:**
- Produces (pure helpers, consumed by Tasks 2-3):
  - `isClientComponent(src: string): boolean` — true if the first non-empty line is `"use client"`/`'use client'`.
  - `referencesWrapper(src: string, name: "withRequestTenant" | "withTenantRoute"): boolean`.
  - `bareMethodExports(src: string): string[]` — names of HTTP-method handlers exported as a bare `export async function NAME`/`export function NAME` (i.e. NOT `export const NAME = withTenantRoute(`). Methods scanned: `GET POST PUT PATCH DELETE`.
  - `listFiles(dir: string, predicate: (path: string) => boolean): string[]` — recursive walk (Node `fs`, no new deps).

- [ ] **Step 1: Write the failing unit tests for the scanner helpers**

```ts
// src/lib/tenant/entry-point-scope.test.ts (first slice)
import { describe, it, expect } from "vitest";
import { isClientComponent, referencesWrapper, bareMethodExports } from "./entry-point-scope";

describe("entry-point-scope helpers", () => {
  it("detects a client component", () => {
    expect(isClientComponent(`"use client";\nexport default function X(){}`)).toBe(true);
    expect(isClientComponent(`// a comment\n"use client"\n`)).toBe(true);
    expect(isClientComponent(`export default function X(){}`)).toBe(false);
  });
  it("finds a referenced wrapper", () => {
    expect(referencesWrapper(`import { withRequestTenant } from "@/lib/tenant/request";`, "withRequestTenant")).toBe(true);
    expect(referencesWrapper(`const x = 1;`, "withRequestTenant")).toBe(false);
  });
  it("flags bare method exports, ignores wrapped ones", () => {
    expect(bareMethodExports(`export async function POST(req){}`)).toEqual(["POST"]);
    expect(bareMethodExports(`export function GET(){}\nexport async function DELETE(){}`)).toEqual(["GET", "DELETE"]);
    expect(bareMethodExports(`export const POST = withTenantRoute(async (req) => {});`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts`
Expected: FAIL — `./entry-point-scope` does not exist.

- [ ] **Step 3: Implement the scanner helpers**

```ts
// src/lib/tenant/entry-point-scope.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export function isClientComponent(src: string): boolean {
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    return /^["']use client["']/.test(line);
  }
  return false;
}

export function referencesWrapper(src: string, name: "withRequestTenant" | "withTenantRoute"): boolean {
  return new RegExp(`\\b${name}\\b`).test(src);
}

export function bareMethodExports(src: string): string[] {
  return METHODS.filter((m) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(src));
}

export function listFiles(dir: string, predicate: (path: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (predicate(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function readSrc(path: string): string {
  return readFileSync(path, "utf8");
}
```

- [ ] **Step 4: Run to verify the helper tests pass**

Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the repo-wide RSC assertion (failing)**

Append to `src/lib/tenant/entry-point-scope.test.ts`:
```ts
import { listFiles, readSrc } from "./entry-point-scope";

const RSC_ROOTS = ["src/app/(app)", "src/app/(portal)"];
const isRsc = (p: string) => /(?:page|layout)\.tsx$/.test(p);

describe("RSC entry points are tenant-scoped", () => {
  it("every server page/layout under (app)/(portal) wraps withRequestTenant", () => {
    const offenders: string[] = [];
    for (const root of RSC_ROOTS) {
      for (const file of listFiles(root, isRsc)) {
        const src = readSrc(file);
        if (isClientComponent(src)) continue;
        if (!referencesWrapper(src, "withRequestTenant")) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```
Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts`
Expected: FAIL — offenders lists all currently-unwrapped `(app)`/`(portal)` server pages/layouts.

- [ ] **Step 6: Wrap every server page/layout under `(app)` and `(portal)`**

For each offender file, apply the RSC idiom: add the `withRequestTenant` import and wrap the `export default` body. Skip any `"use client"` file. Verify `src/app/(app)/layout.tsx` and `src/app/(portal)/layout.tsx` are wrapped (both call `requireUser()` and, for `(app)`, several `currentTenantId()`-dependent loaders).

- [ ] **Step 7: Run the structural test + typecheck/build to verify green**

Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts`
Expected: PASS (offenders empty).
Run: `npm run build` (or the repo's typecheck) — Expected: green (wrapping is type-preserving).

- [ ] **Step 8: Add a functional proof test for insights scoping**

Create `src/lib/dashboard/insights.scope.integration.test.ts` using the repo's existing multi-tenant integration harness (same setup as `src/app/api/internal/audit/log/route.integration.test.ts` — `MULTI_TENANT` on, RLS bootstrap, two seeded tenants). Seed audit events for tenant A, then:
```ts
// bare (auto-scope only, ALS = "default") reproduces the bug:
const bare = await getInsights();               // within a request whose host → tenant A, NO withRequestTenant
// scoped (what the wrapped page does):
const scoped = await withTenant(tenantAId, () => getInsights());
expect(bare.someCountField).toBe(0);            // demonstrates the "default" miss
expect(scoped.someCountField).toBeGreaterThan(0);
```
Pick a concrete numeric field from the `getInsights()` return (e.g. an allow/deny total or a grants count). Follow the harness's host-mocking helper for the bare call. Expected after Task 1's wrapping: the insights PAGE sets the scope, so the lib returns the scoped (non-zero) result; this test pins that `withTenant`/`withRequestTenant` is what makes `getInsights()` correct.

- [ ] **Step 9: Run the functional test**

Run: `npx vitest run src/lib/dashboard/insights.scope.integration.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/tenant/entry-point-scope.ts src/lib/tenant/entry-point-scope.test.ts \
        src/lib/dashboard/insights.scope.integration.test.ts "src/app/(app)" "src/app/(portal)" \
        docs/superpowers/specs/2026-09-08-tenant-scope-entry-points-design.md \
        docs/superpowers/plans/2026-09-08-tenant-scope-entry-points.md
git commit -m "fix(tenant): scope (app)/(portal) RSC renders to the request tenant"
```

---

### Task 2: Enforce wrapping of `/api/admin/**` route handlers

**Files:**
- Modify: every `src/app/api/admin/**/route.ts` (wrap each method export in `withTenantRoute`)
- Modify: `src/lib/tenant/entry-point-scope.test.ts` (add the admin-routes assertion)
- Create: `src/app/api/admin/smtp/route.scope.integration.test.ts` (config round-trip proof)

**Interfaces:**
- Consumes: `listFiles`, `readSrc`, `bareMethodExports`, `referencesWrapper` from Task 1.
- Produces: the admin surface fully wrapped (Task 3 extends the same assertion to the remaining routes).

- [ ] **Step 1: Add the failing admin-routes assertion**

Append to `src/lib/tenant/entry-point-scope.test.ts`:
```ts
const isRoute = (p: string) => /route\.ts$/.test(p);

describe("admin route handlers are tenant-scoped", () => {
  it("every /api/admin route wraps all method exports in withTenantRoute", () => {
    const offenders: string[] = [];
    for (const file of listFiles("src/app/api/admin", isRoute)) {
      const src = readSrc(file);
      const bare = bareMethodExports(src);
      if (bare.length || !referencesWrapper(src, "withTenantRoute")) offenders.push(`${file} [${bare.join(",")}]`);
    }
    expect(offenders).toEqual([]);
  });
});
```
Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts -t "admin route"`
Expected: FAIL — lists all unwrapped admin routes.

- [ ] **Step 2: Wrap every `/api/admin/**` route handler**

Apply the route idiom to each file: add the `withTenantRoute` import, convert each `export async function METHOD(...)` to `export const METHOD = withTenantRoute(async (...) => { ... })`. Preserve parameter lists exactly (including `{ params }`). The full file list (60 handlers) is under `src/app/api/admin/` — use `listFiles` output / the offenders list to enumerate; wrap every one.

- [ ] **Step 3: Run the admin assertion + build**

Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts -t "admin route"`
Expected: PASS.
Run: `npm run build` — Expected: green.

- [ ] **Step 4: Write the failing config round-trip proof**

Create `src/app/api/admin/smtp/route.scope.integration.test.ts` (multi-tenant harness, tenant A host, an admin user with `configure`). Invoke the SMTP `POST` handler with a config payload, then read the row back **in a fresh request scope** (either the handler's read path or `db.smtpConfig.findUnique({ where: { tenantId: tenantAId } })` under `withTenant(tenantAId, …)`):
```ts
await POST(makeReq({ host: "smtp.a.test", port: 587, fromEmail: "a@a.test", password: "pw", enabled: true }));
const saved = await withTenant(tenantAId, () => db.smtpConfig.findUnique({ where: { tenantId: tenantAId } }));
expect(saved?.host).toBe("smtp.a.test");           // written under tenant A, not "default"
const none = await withTenant(DEFAULT_TENANT, () => db.smtpConfig.findUnique({ where: { tenantId: DEFAULT_TENANT } }));
expect(none).toBeNull();                            // nothing leaked to the "default" sentinel
```
(Use the harness's request/host mock so `POST` resolves to tenant A. `DEFAULT_TENANT` is exported from `@/lib/tenant/context`.)

- [ ] **Step 5: Run the proof test**

Run: `npx vitest run src/app/api/admin/smtp/route.scope.integration.test.ts`
Expected: PASS (before Task 2 wrapping this would write under A via the trigger but the handler's own read used `"default"`; with wrapping the handler's `currentTenantId()` is A throughout).

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/admin" src/lib/tenant/entry-point-scope.test.ts \
        src/app/api/admin/smtp/route.scope.integration.test.ts
git commit -m "fix(tenant): scope /api/admin route handlers to the request tenant"
```

---

### Task 3: Wrap the remaining host-resolvable tenant routes; finalize the invariant + exempt allowlist; audit-chain & isolation proofs

**Files:**
- Modify: the remaining included route handlers:
  `src/app/api/access/**/route.ts`, `src/app/api/branding/splash/route.ts`,
  `src/app/api/gateway/[siteId]/**/route.ts`, `src/app/api/isolated/files/**/route.ts`,
  `src/app/api/passkeys/[id]/route.ts`, `src/app/api/portal/history/route.ts`,
  `src/app/api/settings/**/route.ts`, `src/app/api/sites/[id]/logo/route.ts`
- Modify: `src/lib/tenant/entry-point-scope.test.ts` (whole-`/api` classification + exempt allowlist)
- Create: `src/app/api/gateway/[siteId]/consent/route.scope.integration.test.ts` (audit-chain proof)

**Interfaces:**
- Consumes: all Task 1 helpers; the admin assertion from Task 2.
- Produces: the complete, enforced invariant over `src/app/api` + `(app)` + `(portal)`.

- [ ] **Step 1: Wrap each remaining included route handler**

Apply the route idiom to every file in the Files list above. Leave already-wrapped files (`api/access/my-grants`) unchanged. `api/gateway/[siteId]/consent` and `api/branding/splash` are correctness-critical — confirm they are wrapped.

- [ ] **Step 2: Replace the per-directory route assertions with a whole-`/api` invariant + exempt allowlist (failing first if anything is unclassified/unwrapped)**

In `src/lib/tenant/entry-point-scope.test.ts`, replace the admin-only route assertion with one that scans **all** of `src/app/api`, classifying each `route.ts` as included (must be wrapped) or exempt (explicit allowlist with a reason). A file under neither prefix fails the test (forces classification):
```ts
// Exempt: resolve tenant by a non-host mechanism, or tenant-agnostic. Reason each.
const EXEMPT_PREFIXES: Array<[string, string]> = [
  ["src/app/api/internal/", "dataplane calls; tenant from dataplane identifier (withTenantFrom)"],
  ["src/app/api/platform/", "platform tenant; PLATFORM_TENANT_ID scope"],
  ["src/app/api/cron/", "no request host; fans out per tenant via forEachTenant"],
  ["src/app/api/auth/", "registration/login; own token/host flow"],
  ["src/app/api/connector/enroll/", "tunnel host + pairing token; resolved via SECURITY DEFINER"],
  ["src/app/api/recovery/", "pre-session recovery; resolved by token/email"],
  ["src/app/api/health/", "tenant-agnostic liveness"],
];
const norm = (p: string) => p.split(require("node:path").sep).join("/");
describe("all /api tenant route handlers are scoped or explicitly exempt", () => {
  it("every route.ts is wrapped or allow-listed with a reason", () => {
    const unwrapped: string[] = [];
    const unclassified: string[] = [];
    for (const file of listFiles("src/app/api", isRoute)) {
      const f = norm(file);
      if (EXEMPT_PREFIXES.some(([p]) => f.startsWith(p))) continue;
      const src = readSrc(file);
      const bare = bareMethodExports(src);
      if (bare.length || !referencesWrapper(src, "withTenantRoute")) unwrapped.push(`${f} [${bare.join(",")}]`);
    }
    expect({ unwrapped, unclassified }).toEqual({ unwrapped: [], unclassified: [] });
  });
});
```
(Keep the RSC assertion from Task 1 as-is.) Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts`
Expected: initially FAIL if any included route is still unwrapped; after Step 1 it should list none → adjust wrapping until green.

- [ ] **Step 3: Run the full structural test + build**

Run: `npx vitest run src/lib/tenant/entry-point-scope.test.ts`
Expected: PASS.
Run: `npm run build` — Expected: green.

- [ ] **Step 4: Write the failing audit-chain proof**

Create `src/app/api/gateway/[siteId]/consent/route.scope.integration.test.ts` (multi-tenant harness, tenant A host, a vendor user + a site in A). Invoke the consent `POST` handler **twice** and assert no throw and an intact single chain head for tenant A:
```ts
const res1 = await POST(makeReq(), { params: Promise.resolve({ siteId: siteAId }) });
const res2 = await POST(makeReq(), { params: Promise.resolve({ siteId: siteAId }) });
expect(res1.status).toBe(200);
expect(res2.status).toBe(200);
const heads = await withTenant(tenantAId, () =>
  db.auditChainState.findMany({ where: { scope: "access" } }));
expect(heads).toHaveLength(1);
expect(heads[0].tenantId).toBe(tenantAId);        // not "default"
const events = await withTenant(tenantAId, () =>
  db.auditEvent.count({ where: { decision: "ALLOW" } }));
expect(events).toBeGreaterThanOrEqual(2);
```
Note: the consent handler swallows append errors in a try/catch and still returns 200, so assert on the **chain state/events**, not only the status — before wrapping, the second append hits the unique collision and records nothing (and/or corrupts the head); after wrapping, both events link under tenant A.

- [ ] **Step 5: Run the audit-chain proof**

Run: `npx vitest run "src/app/api/gateway/[siteId]/consent/route.scope.integration.test.ts"`
Expected: PASS.

- [ ] **Step 6: Add a cross-tenant isolation assertion**

In the same consent or a small new integration test: seed consent/config for tenant A and none for tenant B; assert tenant B's `auditChainState`/`smtpConfig` reads are empty under B's scope (no cross-tenant bleed). Run it: Expected PASS.

- [ ] **Step 7: Full suite, both flag states**

Run (multi-tenant on): `npx vitest run`
Run (self-host / flag off): the repo's flag-off suite command (e.g. `MULTI_TENANT=0 npx vitest run` or the existing npm script) — Expected: all green, proving self-host is byte-behavior-identical.
Run: `npm run build` — Expected: green.

- [ ] **Step 8: Commit**

```bash
git add "src/app/api" src/lib/tenant/entry-point-scope.test.ts \
        "src/app/api/gateway/[siteId]/consent/route.scope.integration.test.ts"
git commit -m "fix(tenant): scope remaining tenant routes + enforce the entry-point invariant"
```

---

## Self-Review

**Spec coverage:**
- §Design.1 (RSC wrapping) → Task 1. §Design.2 (route wrapping) → Tasks 2-3. §Design.3 (included/exempt boundary) → Task 3 Step 2 (whole-`/api` classification + allowlist) + Task 1 (RSC set). §Design.4 (structural test) → Tasks 1-3 assertions. §Design.5 (functional tests: audit, config, insights, isolation) → Task 1 Step 8 (insights), Task 2 Step 4 (config), Task 3 Steps 4-6 (audit + isolation). §Design.6 (self-host regression) → Task 3 Step 7. §Design.7 (recording) → deployment config, out of plan scope (noted).
- The `(app)` settings/config pages (branding/email/policy/sso/directory/updates) are covered by Task 1's uniform `(app)` wrapping (the assertion includes them).

**Placeholder scan:** none — every code step carries concrete code; test field names ("pick a concrete numeric field", harness host-mock) are explicit about what to choose and which existing harness to mirror.

**Type consistency:** helper names (`isClientComponent`, `referencesWrapper`, `bareMethodExports`, `listFiles`, `readSrc`) are defined in Task 1 and reused verbatim in Tasks 2-3. Wrappers (`withRequestTenant`, `withTenantRoute`) and `DEFAULT_TENANT` are imported from existing modules with the signatures in the spec.

**Notes for the implementer:** confirm the exact flag-off test command and the multi-tenant integration harness entry (mirror `src/app/api/internal/audit/log/route.integration.test.ts`) before writing the functional tests; if the harness exposes a host-mock helper, use it for the route-handler invocations.
