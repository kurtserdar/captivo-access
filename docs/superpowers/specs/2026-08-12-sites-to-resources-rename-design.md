# "Sites" → "Resources" — console + docs copy rename

**Status:** approved design (2026-08-12)
**Repo:** `/opt/captivo-access` (public OSS, English-only)

## Goal

Rename the user-facing term **"Site"/"Sites" → "Resource"/"Resources"** across the
admin console UI copy and the markdown docs. The product now covers web apps **and**
remote desktops (RDP/SSH/VNC), so "Resource" is the accurate umbrella term (already used
on the redesigned dashboard KPI strip). This is a **copy change only** — no schema, no
route, no code-identifier change.

## Word choice

- "Site" → "Resource"; "Sites" → "Resources"; "a Site" → "a Resource".
- Keep the word "app"/"internal app" where it already appears meaning the actual
  application (e.g. "Add an internal app") — only the specific term "Site" is renamed.

## In scope — change these (visible strings + doc prose only)

**Console UI** (`src/app/(app)/…`):
- `layout.tsx` — the left-nav `<NavLink href="/admin/sites">` **label text** ("Sites" → "Resources"); the `href` stays.
- `admin/sites/page.tsx` — `metadata.title` "Sites" → "Resources"; the `<h1>Sites</h1>` → `<h1>Resources</h1>`.
- `admin/sites/sites-view.tsx` — "Configured sites" → "Configured resources", plus any other visible "site(s)" copy (empty states, buttons, helper text).
- `admin/sites/[id]/edit/page.tsx` — `metadata.title` "Edit site" → "Edit resource"; `<h1>Edit site</h1>` → "Edit resource".
- `admin/sites/site-form.tsx` — visible labels/hints that say "site" (e.g. "Site name") → "Resource…"; keep `htmlFor`/`id` attribute values (e.g. `site-name`) unchanged.
- `admin/sites/*-button.tsx` (delete/edit/test-connection) — visible button/confirm copy mentioning "site".
- `admin/grants/page.tsx` — the `<th>Site</th>` column header → "Resource".
- `admin/grants/grant-form.tsx` — the "Site" field label → "Resource".
- `admin/grants/test-access-widget.tsx` — the "site" field label → "Resource".
- `admin/audit/audit-table.tsx` — the "Site" filter label → "Resource".
- `admin/live/live-table.tsx` — the `<th>Site</th>` column header → "Resource".
- `admin/connectors/[id]/page.tsx` — "Sites on this connector" → "Resources on this connector"; the audit sub-table `<th>Site</th>` → "Resource".
- `admin/connectors/connector-form.tsx` — copy referencing "a **Site**" → "a **Resource**".
- `admin/notifications/notifications-view.tsx` — the `<th>Site</th>` column header → "Resource".
- `admin/policy/platform-settings-form.tsx` — prose "vendors can reach published **sites**" → "published **resources**".
- `_dashboard/site-health-panel.tsx` — the `<h2>Site health</h2>` → "Resource health".
- `_dashboard/stat-cards.tsx` — "Sites reachable" → "Resources reachable" (this file is no longer rendered by the dashboard, but is updated for consistency so no stale "Sites" copy remains).
- `page.tsx` (getting-started checklist) — the "Define a Site for an app…" hint → "Define a Resource…" (keep the `href="/admin/sites"`).

**Docs** (markdown prose):
- `README.md`, `docs/how-it-works.md`, `docs/quickstart.md`, `docs/install.md` (and any
  other `docs/*.md` containing the term) — prose "Site/Sites" ("A **Site** = which
  internal app", "Which **Site**?", "Define **two things: the app**…", "matched **Site**",
  table headers, mermaid node labels) → "Resource/Resources". Where a doc uses "Site"
  as the console page name, it becomes "Resources" to match the nav.

## Out of scope — do NOT change

- **Prisma `Site` model**, DB tables/columns, `SiteAccessMode`, migrations, seed data.
- **Route path** `/admin/sites` (and every `href="/admin/sites"` / `router.push("/admin/sites")`).
- **API routes** (`/api/**/sites/**`, `/api/internal/site/**`).
- **Code identifiers:** `siteId`, `siteName`, `site.name`, `.site`, `SitesIcon` (component
  name), `SiteHealthPanel`, `getSite*`, type/interface names, variable names, `data-*`,
  `htmlFor`/`id`/`name` form-control attribute values, CSS class names.
- Config examples in docs that reference real field names, routes, env vars, or the
  connector's `ALLOWED_TARGETS`.

## Approach

Targeted edits to **visible string literals and doc prose only** — never a blind
find-and-replace. A global `sed` would rewrite `siteId`, `/admin/sites`, `SiteAccessMode`,
and `SitesIcon` and break the build; each change is applied to the specific rendered
string. `SitesIcon` keeps its component name and is rendered next to the "Resources"
heading unchanged.

## Testing / verification

No unit tests (pure copy change). Verify with:
1. `pnpm build` — typecheck proves no identifier was renamed by accident.
2. `pnpm test` — full suite stays green (nothing logic changed).
3. **Grep audit** — after the edits, a scan for user-facing "Site"/"Sites" that excludes
   the allowed identifiers (`siteId`, `siteName`, `site\.`, `/admin/sites`, `SitesIcon`,
   `SiteAccessMode`, `SiteHealth`, `getSite`, `: Site`, `Site\[`) returns nothing in the
   changed UI files, and the docs contain no prose "Site/Sites" left as the concept name.
4. **Gate A (operator, after deploy):** the left nav reads "Resources"; `/admin/sites`
   still loads and its title/heading read "Resources"; grants/audit/live/connectors/
   notifications columns and labels read "Resource"; the dashboard "Resource health"
   panel; docs on GitHub read "Resource" throughout and still render.

## Deploy notes

- Copy-only, manager-only → bump `access-manager`. No migrate, no data-plane/connector
  change. Ships together with the pending dashboard spacing fix (`0bbc947`). Suggested
  version **v0.24.0**. English-only + GitHub Release note.

## Non-goals

- No route move to `/admin/resources` (path stays `/admin/sites`).
- No model/field/type rename; no API change; no redirect.
