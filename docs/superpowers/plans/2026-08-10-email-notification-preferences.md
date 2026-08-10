# Email Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global per-event-type toggles that control whether each notification email is sent, and email the vendor when their access request is approved or denied.

**Architecture:** Three nullable boolean columns on the `PlatformSettings` singleton back a small event registry + gate helper (`notifyEmailEnabled(key)`). Every notification email send is wrapped in that gate; the bell and webhook are untouched. A new `accessDecisionEmail` template closes the access loop by emailing the vendor on approve/deny. Manager + database only.

**Tech Stack:** Next.js (App Router, Node runtime), Prisma 7 (`db push`), Postgres, nodemailer (existing mailer), Vitest.

## Global Constraints

- **English only** in all code, comments, commit messages, UI strings, docs.
- **No Claude signature** in commits (no `Co-Authored-By: Claude`, no "Generated with").
- **Prisma `db push`**, never `migrate`. Local push needs the DB creds from the running container with the host rewritten to `127.0.0.1:5434` (the dev/prod Postgres is `cap-access-postgres`, published on `127.0.0.1:5434`, IPv4-only — `localhost` resolves to `::1` and fails):
  ```bash
  cd /opt/captivo-access
  LOCAL_URL=$(docker exec cap-access-manager env | grep '^DATABASE_URL=' | cut -d= -f2- | sed -E 's#@[^:/]+:5432#@127.0.0.1:5434#')
  DATABASE_URL="$LOCAL_URL" pnpm db:push && pnpm db:generate
  ```
- **Toggles govern email only** — the `Notification` bell rows and the webhook still fire regardless.
- **Default on (opt-out):** a null/unset column means the email is enabled. Rule: enabled unless the value is exactly `false`.
- **Best-effort email:** `sendMail` never throws; a failed email must never change a caller's HTTP result or break a cron. Keep every send in a try/catch or behind the non-throwing `sendMail`.
- **Manager only:** do not touch data-plane or connector files.
- **Follow existing patterns:** settings via `src/lib/settings/platform.ts` (interface + EMPTY + get + save); templates via `renderEmail`/`escapeHtml` in `src/lib/email/templates.ts`; admin routes gate with `getCurrentUser` + `can(role, …)`.

---

## File Structure

- `prisma/schema.prisma` — three nullable booleans on `PlatformSettings`.
- `src/lib/settings/platform.ts` — the three fields threaded through interface/EMPTY/get.
- `src/lib/notifications/events.ts` (new) — `NotifKey`, `NOTIF_EVENTS`, `emailEnabledFromValue`, `notifyEmailEnabled`.
- `src/lib/notifications/events.test.ts` (new) — `emailEnabledFromValue` unit.
- `src/lib/email/templates.ts` — `accessDecisionEmail`.
- `src/lib/email/templates.test.ts` — `accessDecisionEmail` tests.
- `src/lib/notifications.ts` — gate the site-event email with `site_health`.
- `src/app/api/access/requests/route.ts` — gate the admin email with `access_requests`.
- `src/app/api/admin/grants/[id]/decision/route.ts` — email the vendor on decision, gated by `access_decisions`.
- `src/app/api/admin/policy/platform/route.ts` — accept the three booleans.
- `src/app/(app)/admin/policy/platform-settings-form.tsx` — three switches.

---

### Task 1: Schema + settings layer

**Files:**
- Modify: `prisma/schema.prisma` (PlatformSettings model)
- Modify: `src/lib/settings/platform.ts`

**Interfaces:**
- Produces: `PlatformSettings.notifySiteHealth`, `.notifyAccessRequests`, `.notifyAccessDecisions` — all `boolean | null`, on the interface and readable via `getPlatformSettings()`; persisted by the existing `savePlatformSettings` spread.

- [ ] **Step 1: Add the columns.** In `prisma/schema.prisma`, in the `PlatformSettings` model, add before `updatedAt`:

```prisma
  notifySiteHealth      Boolean? // email admins on site up/down; null = default on
  notifyAccessRequests  Boolean? // email admins on new access requests; null = default on
  notifyAccessDecisions Boolean? // email the vendor on approve/deny; null = default on
```

- [ ] **Step 2: Push + generate.** Run the `db push` recipe from Global Constraints, then `pnpm db:generate`. Expected: "Your database is now in sync" + "Generated Prisma Client".

- [ ] **Step 3: Thread the fields through `platform.ts`.** In `src/lib/settings/platform.ts`:
  - Add to the `PlatformSettings` interface: `notifySiteHealth: boolean | null; notifyAccessRequests: boolean | null; notifyAccessDecisions: boolean | null;`
  - Add the same three keys (all `null`) to `EMPTY`.
  - In `getPlatformSettings`, add to the built `s` object:
    ```ts
    notifySiteHealth: c?.notifySiteHealth ?? null,
    notifyAccessRequests: c?.notifyAccessRequests ?? null,
    notifyAccessDecisions: c?.notifyAccessDecisions ?? null,
    ```
  (`savePlatformSettings` spreads the whole object, so it needs no change.)

- [ ] **Step 4: Verify build.** Run `pnpm build`. Expected: BUILD passes.

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add prisma/schema.prisma src/lib/settings/platform.ts && git commit -m "feat(notifications): notification-preference columns on PlatformSettings"
```

---

### Task 2: Event registry + gate helper

**Files:**
- Create: `src/lib/notifications/events.ts`
- Create: `src/lib/notifications/events.test.ts`

**Interfaces:**
- Consumes: `getPlatformSettings` (Task 1 fields).
- Produces:
  - `type NotifKey = "site_health" | "access_requests" | "access_decisions"`.
  - `NOTIF_EVENTS: { key: NotifKey; label: string; hint: string }[]`.
  - `emailEnabledFromValue(v: boolean | null | undefined): boolean` — pure default-on rule.
  - `notifyEmailEnabled(key: NotifKey): Promise<boolean>`.

- [ ] **Step 1: Write the failing test.** In `src/lib/notifications/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emailEnabledFromValue, NOTIF_EVENTS } from "./events";

describe("emailEnabledFromValue (default-on rule)", () => {
  it("enables when the value is true", () => expect(emailEnabledFromValue(true)).toBe(true));
  it("enables when the value is null (unset)", () => expect(emailEnabledFromValue(null)).toBe(true));
  it("enables when the value is undefined", () => expect(emailEnabledFromValue(undefined)).toBe(true));
  it("disables only when the value is exactly false", () => expect(emailEnabledFromValue(false)).toBe(false));
});

describe("NOTIF_EVENTS", () => {
  it("lists the three event keys", () => {
    expect(NOTIF_EVENTS.map((e) => e.key)).toEqual(["site_health", "access_requests", "access_decisions"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `pnpm test src/lib/notifications/events.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/notifications/events.ts`.**

```ts
import { getPlatformSettings } from "@/lib/settings/platform";

// Canonical notification event keys, with UI metadata so the Policy form and the
// send sites agree on one list. Toggles govern EMAIL only — the in-console bell
// and the webhook are unaffected.
export type NotifKey = "site_health" | "access_requests" | "access_decisions";

export const NOTIF_EVENTS: { key: NotifKey; label: string; hint: string }[] = [
  { key: "site_health", label: "Site up / down", hint: "Email admins when a site becomes unreachable or recovers." },
  { key: "access_requests", label: "New access requests", hint: "Email admins when a vendor requests access to a site." },
  { key: "access_decisions", label: "Access decisions", hint: "Email the vendor when their access request is approved or denied." },
];

// Default-on rule: email is enabled unless the stored value is explicitly false.
export function emailEnabledFromValue(v: boolean | null | undefined): boolean {
  return v !== false;
}

export async function notifyEmailEnabled(key: NotifKey): Promise<boolean> {
  const s = await getPlatformSettings();
  const map: Record<NotifKey, boolean | null> = {
    site_health: s.notifySiteHealth,
    access_requests: s.notifyAccessRequests,
    access_decisions: s.notifyAccessDecisions,
  };
  return emailEnabledFromValue(map[key]);
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `pnpm test src/lib/notifications/events.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/notifications/events.ts src/lib/notifications/events.test.ts && git commit -m "feat(notifications): event registry + email-enabled gate helper"
```

---

### Task 3: Access-decision email template

**Files:**
- Modify: `src/lib/email/templates.ts`
- Modify: `src/lib/email/templates.test.ts`

**Interfaces:**
- Produces: `accessDecisionEmail({ decision: "approved" | "denied", siteName: string, consoleUrl: string }): { subject: string; html: string; text: string }`.

- [ ] **Step 1: Write the failing test.** Add to `src/lib/email/templates.test.ts`:
  - Add `accessDecisionEmail` to the import line from `./templates`.
  - Add inside the `describe("email templates", …)` block:

```ts
  it("accessDecisionEmail (approved) names the site and links to My access", () => {
    const m = accessDecisionEmail({ decision: "approved", siteName: "Grafana", consoleUrl: "https://c.test" });
    expect(m.subject).toContain("approved");
    expect(m.subject).toContain("Grafana");
    expect(m.text).toContain("Grafana");
    expect(m.html).toContain("https://c.test/access");
  });
  it("accessDecisionEmail (denied) reads as a decline and omits the button with no url", () => {
    const m = accessDecisionEmail({ decision: "denied", siteName: "Grafana", consoleUrl: "" });
    expect(m.subject.toLowerCase()).toContain("declined");
    expect(m.html).not.toContain("href=\"/access\"");
  });
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `pnpm test src/lib/email/templates.test.ts`. Expected: FAIL — `accessDecisionEmail` is not exported.

- [ ] **Step 3: Implement the template.** Append to `src/lib/email/templates.ts`:

```ts
export function accessDecisionEmail(input: {
  decision: "approved" | "denied";
  siteName: string;
  consoleUrl: string;
}): { subject: string; html: string; text: string } {
  const approved = input.decision === "approved";
  const subject = approved ? `Access approved: ${input.siteName}` : `Access request declined: ${input.siteName}`;
  const line = approved
    ? `Your request to access ${escapeHtml(input.siteName)} was approved. It's ready in your access list.`
    : `Your request to access ${escapeHtml(input.siteName)} was declined.`;
  const { html, text } = renderEmail({
    heading: escapeHtml(subject),
    bodyLines: [line],
    button: input.consoleUrl ? { label: "Open My access", url: `${input.consoleUrl}/access` } : undefined,
  });
  return { subject, html, text };
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `pnpm test src/lib/email/templates.test.ts`. Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/email/templates.ts src/lib/email/templates.test.ts && git commit -m "feat(notifications): access-decision email template"
```

---

### Task 4: Wire the gate into all notification sends

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/app/api/access/requests/route.ts`
- Modify: `src/app/api/admin/grants/[id]/decision/route.ts`

**Interfaces:**
- Consumes: `notifyEmailEnabled` (Task 2), `accessDecisionEmail` (Task 3), `sendMail` (existing mailer), `db` (existing).

- [ ] **Step 1: Gate the site-event email.** In `src/lib/notifications.ts`:
  - Add the import: `import { notifyEmailEnabled } from "@/lib/notifications/events";`
  - Wrap the existing admin-email block (the `try { const admins = await getAdminEmails(); … } catch {}` inside `notifyTransition`) so it only runs when enabled:
    ```ts
    if (await notifyEmailEnabled("site_health")) {
      try {
        const admins = await getAdminEmails();
        // …unchanged body…
      } catch {
        // Best-effort: email must never break the cron.
      }
    }
    ```
  Leave the `db.notification.create` bell row and `fireWebhook(input)` exactly as they are — they stay unconditional.

- [ ] **Step 2: Gate the access-request email.** In `src/app/api/access/requests/route.ts`:
  - Add the import: `import { notifyEmailEnabled } from "@/lib/notifications/events";`
  - Wrap the existing `try { const admins = await getAdminEmails(); … } catch {}` block in `if (await notifyEmailEnabled("access_requests")) { … }`.

- [ ] **Step 3: Email the vendor on a decision.** In `src/app/api/admin/grants/[id]/decision/route.ts`:
  - Add imports:
    ```ts
    import { db } from "@/lib/db";
    import { sendMail } from "@/lib/email/mailer";
    import { accessDecisionEmail } from "@/lib/email/templates";
    import { notifyEmailEnabled } from "@/lib/notifications/events";
    ```
  - Replace the success return block:
    ```ts
    const count = await decideGrant(id, decision, admin.id, reason);
    if (count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

    return NextResponse.json({ ok: true });
    ```
    with:
    ```ts
    const count = await decideGrant(id, decision, admin.id, reason);
    if (count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

    if (await notifyEmailEnabled("access_decisions")) {
      try {
        const grant = await db.accessGrant.findUnique({
          where: { id },
          select: { user: { select: { email: true } }, site: { select: { name: true } } },
        });
        if (grant?.user?.email) {
          const m = accessDecisionEmail({
            decision: decision === "approve" ? "approved" : "denied",
            siteName: grant.site.name,
            consoleUrl: (process.env.MANAGER_PUBLIC_URL ?? "").replace(/\/$/, ""),
          });
          await sendMail({ to: grant.user.email, subject: m.subject, html: m.html, text: m.text });
        }
      } catch {
        // Best-effort: emailing the vendor must never change the decision outcome.
      }
    }

    return NextResponse.json({ ok: true });
    ```

- [ ] **Step 4: Verify build + full suite.** Run `pnpm test && pnpm build`. Expected: all tests PASS, BUILD passes.

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/notifications.ts src/app/api/access/requests/route.ts "src/app/api/admin/grants/[id]/decision/route.ts" && git commit -m "feat(notifications): gate notification emails + email vendor on access decision"
```

---

### Task 5: Policy UI + save route

**Files:**
- Modify: `src/app/api/admin/policy/platform/route.ts`
- Modify: `src/app/(app)/admin/policy/platform-settings-form.tsx`

**Interfaces:**
- Consumes: `PlatformSettings` fields (Task 1), `NOTIF_EVENTS` (Task 2), `savePlatformSettings` (existing).

- [ ] **Step 1: Accept the three booleans in the save route.** In `src/app/api/admin/policy/platform/route.ts`, add these keys to the object passed to `savePlatformSettings({...})`:

```ts
    notifySiteHealth: body.notifySiteHealth !== false,
    notifyAccessRequests: body.notifyAccessRequests !== false,
    notifyAccessDecisions: body.notifyAccessDecisions !== false,
```

(Default-on coercion: anything that isn't explicitly `false` persists as `true`.)

- [ ] **Step 2: Add state + body keys in the form.** In `src/app/(app)/admin/policy/platform-settings-form.tsx`:
  - Add the registry import at the top: `import { NOTIF_EVENTS, type NotifKey } from "@/lib/notifications/events";`
  - Add state seeded from `initial` (default on when null):
    ```ts
    const [notif, setNotif] = useState<Record<NotifKey, boolean>>({
      site_health: initial.notifySiteHealth !== false,
      access_requests: initial.notifyAccessRequests !== false,
      access_decisions: initial.notifyAccessDecisions !== false,
    });
    ```
  - Add the three keys to the `body` in `save()`'s `JSON.stringify`:
    ```ts
    notifySiteHealth: notif.site_health,
    notifyAccessRequests: notif.access_requests,
    notifyAccessDecisions: notif.access_decisions,
    ```

- [ ] **Step 3: Render the switches.** In the same form, add a new settings group at the end of the `<div className="settings">` block (before its closing `</div>`), one `.switch` per registry entry:

```tsx
        {NOTIF_EVENTS.map((ev) => (
          <div className="setting" key={ev.key}>
            <div className="setting-main">
              <div className="setting-label">Email: {ev.label}</div>
              <div className="setting-hint">{ev.hint}</div>
            </div>
            <div className="setting-ctl">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notif[ev.key]}
                  onChange={(e) => setNotif((n) => ({ ...n, [ev.key]: e.target.checked }))}
                />
                <span className="track" />
              </label>
            </div>
          </div>
        ))}
```

- [ ] **Step 4: Verify build.** Run `pnpm build`. Expected: BUILD passes.

- [ ] **Step 5: Manually verify.** In the Policy page, the three "Email: …" switches render, default on; toggling one off and saving persists `false` (confirm via a follow-up load). No unit test — the route hits auth + DB and the form is client-only; the default-on coercion is covered by build + this check.

- [ ] **Step 6: Commit.**

```bash
cd /opt/captivo-access && git add src/app/api/admin/policy/platform/route.ts "src/app/(app)/admin/policy/platform-settings-form.tsx" && git commit -m "feat(notifications): Policy toggles for notification emails"
```

---

## Deployment (after all tasks reviewed)

- `prisma db push` (Task 1) applies the additive columns; the prod deploy `migrate` one-shot is idempotent.
- Manager image bump only; data-plane and connector unchanged. No new cron, no new dependency.
- Write English, user-facing GitHub release notes for the tag.

## Self-Review

**Spec coverage:**
- Toggles govern email only → Task 4 wraps only email blocks; bell/webhook untouched. ✓
- Default on (opt-out) → `emailEnabledFromValue` (Task 2) + `!== false` coercion in save route (Task 5) + null columns (Task 1). ✓
- Global, in Policy → Task 5 switches. ✓
- Three event keys / registry → Task 2. ✓
- Three columns → Task 1. ✓
- Gate helper every send checks → Task 4 (site_health, access_requests, access_decisions). ✓
- accessDecisionEmail template + vendor send on approve/deny → Task 3 + Task 4 Step 3. ✓
- Best-effort, never changes outcome → Task 4 Step 3 try/catch, `sendMail` non-throwing. ✓
- Manager only, no data-plane/connector → respected. ✓
- Tests in existing style → Task 2 (events.test), Task 3 (templates.test). ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code.

**Type consistency:** `NotifKey` union defined in Task 2, used in Task 5. `emailEnabledFromValue(boolean|null|undefined)` (Task 2) matches the `!== false` semantics used in Task 5's save coercion. Column names `notifySiteHealth`/`notifyAccessRequests`/`notifyAccessDecisions` identical across schema (Task 1), interface (Task 1), registry map (Task 2), save route (Task 5), form (Task 5). `accessDecisionEmail({decision,siteName,consoleUrl})` (Task 3) matches its call in Task 4 Step 3. Decision route maps `"approve"→"approved"` / `"deny"→"denied"` to match the template's `"approved"|"denied"` param.
