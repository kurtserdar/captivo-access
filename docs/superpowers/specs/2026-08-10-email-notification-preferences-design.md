# Email Notification Preferences (backbone) — Design

**Date:** 2026-08-10
**Status:** Approved for planning
**Area:** Notifications / email

## Problem

Captivo Access already sends event emails, but always unconditionally (gated
only by whether SMTP is configured and enabled). There is no way for an operator
to control *which* events send email. Current email sends:

- **Invite / invite resend** → the invitee (a deliberate, user-initiated send —
  not a notification, out of scope here).
- **Site down / recovered** → admins (`lib/notifications.ts`).
- **New access request** → admins (`api/access/requests`).

There is also a clear gap in the access lifecycle: when an admin **approves or
denies** an access request, the vendor who asked is **not** emailed — the
request→admin direction exists, the decision→vendor direction does not.

## Goal

A **global, per-event-type on/off toggle** (in Policy) that controls whether each
notification **email** is sent, plus the missing **access-decision** email to the
vendor. Toggles govern **email only** — the in-console notification bell and the
outbound webhook are unaffected.

This is the backbone. A later spec adds new events (connector offline, security
alerts) that plug into it.

## Key decisions (approved)

1. **Toggles govern email only.** The bell (`Notification` rows) and the webhook
   still fire regardless; only the email send is gated.
2. **Default on (opt-out).** Every notification email is enabled by default; an
   operator turns individual types off.
3. **Global, not per-admin.** One switch per event type in Policy, applying to all
   recipients. (Per-admin subscriptions are explicitly out of scope.)
4. **Decision emails cover both approved and denied** — the vendor is told the
   outcome honestly either way.

## Scope

**In scope (this spec):**
- Event registry for the three toggle keys.
- Three `PlatformSettings` boolean columns + resolvers (default true).
- A gate helper every email send checks.
- Wire the two existing notification emails (site health, access request) through
  the gate.
- New `accessDecisionEmail` template + send the vendor on approve/deny, gated.
- Policy UI: three switches.

**Out of scope (later specs):**
- `connector_offline` email (needs edge-detection at the connector status-report
  site).
- Security alerts (`new_passkey`; new-device login needs device tracking).
- Per-admin subscriptions.
- Gating the webhook or the bell.
- Invite emails (user-initiated, not a notification).

**Unchanged components:** data-plane and connector are not touched. Manager +
database only.

## Event registry

`src/lib/notifications/events.ts` — the canonical toggle keys with UI metadata, so
the settings form and the send sites agree on one list:

```ts
export type NotifKey = "site_health" | "access_requests" | "access_decisions";

export const NOTIF_EVENTS: { key: NotifKey; label: string; hint: string }[] = [
  { key: "site_health",     label: "Site up / down",   hint: "Email admins when a site becomes unreachable or recovers." },
  { key: "access_requests", label: "New access requests", hint: "Email admins when a vendor requests access to a site." },
  { key: "access_decisions", label: "Access decisions",  hint: "Email the vendor when their access request is approved or denied." },
];
```

## Data model

Three nullable booleans on the `PlatformSettings` singleton (null → default true):

```prisma
  notifySiteHealth      Boolean? // email admins on site up/down; null = default on
  notifyAccessRequests  Boolean? // email admins on new access requests; null = default on
  notifyAccessDecisions Boolean? // email the vendor on approve/deny; null = default on
```

Added to the `PlatformSettings` interface / `EMPTY` / `getPlatformSettings` /
`savePlatformSettings` the same way the existing settings are, following
`src/lib/settings/platform.ts`.

## Gate helper

In `src/lib/notifications/events.ts`. The default-on rule is factored into a pure,
directly-testable helper:

```ts
import { getPlatformSettings } from "@/lib/settings/platform";

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

## Wiring the existing sends

- **`lib/notifications.ts` → `notifyTransition`:** the bell-row insert and
  `fireWebhook` stay unconditional. Wrap only the email block in
  `if (await notifyEmailEnabled("site_health")) { … sendMail … }`.
- **`api/access/requests` route:** wrap the admin-email block in
  `if (await notifyEmailEnabled("access_requests")) { … }`.

## New: access-decision email to the vendor

- **Template** `accessDecisionEmail({ decision, siteName, consoleUrl })` in
  `src/lib/email/templates.ts`, where `decision: "approved" | "denied"`. Reuses the
  shared `renderEmail` layout like the other templates. Subject e.g. `Access
  approved: <site>` / `Access request declined: <site>`.
- **Send site:** `api/admin/grants/[id]/decision`. After the decision is
  successfully persisted (the existing conditional `decideGrant` update), if
  `notifyEmailEnabled("access_decisions")`, look up the grant's vendor email and
  site name and `sendMail` to the vendor. Best-effort in a try/catch — a failed
  email must never change the decision's outcome or HTTP result. The lookup must
  read the grant's `userId → user.email` and `siteId → site.name`.

## Policy UI

In `src/app/(app)/admin/policy/platform-settings-form.tsx`, a new settings group
"Email notifications" rendering one `.switch` per `NOTIF_EVENTS` entry (label +
hint from the registry), bound to local state seeded from `initial`. The save
route (`api/admin/policy/platform`) accepts the three booleans and persists them
via `savePlatformSettings`; missing/invalid values coerce to `true` (default on).

## Error handling

All email remains best-effort: `sendMail` already returns a result and never
throws into the caller. SMTP unconfigured/disabled → silent no-op. The gate check
is a cheap settings read (already cached 30s in `getPlatformSettings`).

## Testing

Following the existing `src/lib/email/templates.test.ts` and pure-unit style:

- **Template:** `accessDecisionEmail` renders a non-empty subject/text/html for
  both `approved` and `denied`, and includes the site name.
- **Gate:** `emailEnabledFromValue` — unit test the default-on rule directly:
  `true`, `null`, `undefined` → `true`; `false` → `false`. (`notifyEmailEnabled`
  is a thin DB read over this pure helper and needs no separate test.)

## Deployment

- Prisma `db push` adds the three nullable columns (additive; existing rows read
  as null → default on). Applied to the local DB in the schema task; the deploy
  `migrate` one-shot is idempotent.
- Manager image bump; data-plane and connector unchanged.
- No new cron, no new dependency.
