# "Sites" → "Resources" Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the user-facing term "Site/Sites" → "Resource/Resources" across the admin console UI copy and the markdown docs, leaving all code identifiers, routes, and the Prisma model untouched.

**Architecture:** Targeted edits to visible string literals and doc prose only — never a blind find-replace. A grep audit that excludes the allowed identifiers proves completeness; `pnpm build` proves no identifier was renamed by accident.

**Tech Stack:** Next.js 16 / React 19 (TSX copy), markdown docs.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **Copy only** — do NOT touch: Prisma `Site` model / DB / `SiteAccessMode`; route path `/admin/sites` and every `href`/`push` to it; API routes; identifiers `siteId`, `siteName`, `site.name`, `.site`, `sites` (Prisma relation / variables), `SitesIcon`, `SiteHealthPanel`, `getSite*`, `EditSiteButton`/`SitesView` component names, type names, CSS class names (`site-card-*`, `site-grid`, `site-avatar`), `htmlFor`/`id`/`name`/`value`/`data-*` attribute values (e.g. `site-name`, `gm-kind`, `kind === "SITE"`, `"site-health"` slug key).
- Rename the word "site"/"sites" only where it is **rendered to the user** or is **doc prose**. Keep "app"/"internal app".
- **Manager-only**, no schema/route/API change.
- **Verify:** `pnpm build`; `pnpm test`; the grep audit in each task.

---

### Task 1: Console UI copy rename

**Files:** the TSX files listed below, all under `src/app/(app)/`.

**Interfaces:** none (copy only). Verified by build + test + grep audit.

- [ ] **Step 1: Apply these exact edits (visible strings only)**

Navigation & Resources pages:
- `layout.tsx` — the `<NavLink href="/admin/sites">` link **text** `Sites` → `Resources` (href unchanged).
- `admin/sites/page.tsx` — `metadata = { title: "Sites" }` → `"Resources"`; `<h1>Sites</h1>` → `<h1>Resources</h1>`; the intro `<p>` "A site is an internal upstream reachable through a connector, addressed by its real internal…" → "A resource is an internal upstream…". (Leave `<SitesIcon />` and `sites={rows}`.)
- `admin/sites/sites-view.tsx` — `<h2>Configured sites</h2>` → `<h2>Configured resources</h2>`. (Leave all `site-card-*` classes, `EditSiteButton`, `sites.map`.)
- `admin/sites/[id]/edit/page.tsx` — `metadata` title `"Edit site"` → `"Edit resource"`; `<h1>Edit site</h1>` → `<h1>Edit resource</h1>`.
- `admin/sites/site-form.tsx` — the label text `Site name` → `Resource name` (keep `htmlFor="site-name"`/`id="site-name"`). No other visible "site" text (other labels are Type/Public hostname/Internal address/Protocol/etc.).
- `admin/sites/delete-site-button.tsx` — confirm string `Delete site "${name}"? This also removes ${grants} and can't be undone.` → `Delete resource "${name}"? …`.

Grants:
- `admin/grants/page.tsx` — prose "Grant a user time-boxed access to a **site**. Leave the end date empty…" → "…access to a **resource**. …"; the `<th>Site</th>` → `<th>Resource</th>`. (Leave `sites.length`, `sites={sites}`.)
- `admin/grants/grant-form.tsx` — the label text `Site` (line ~101, inside `htmlFor="grant-site"`) → `Resource`. (Keep `htmlFor="grant-site"`, `sites.map`.)
- `admin/grants/test-access-widget.tsx` — "Pick a user and a **site** to see the live access decision." → "…a **resource**…".

Audit / Live / Recent activity / Recordings:
- `admin/audit/audit-table.tsx` — `<option value="">All sites</option>` → `All resources`; `<th>Site / Host</th>` → `<th>Resource / Host</th>`. (Leave `filters.siteId`, `updateFilter("siteId", …)`, `sites.map`.)
- `admin/live/live-table.tsx` — `<th>Site</th>` → `<th>Resource</th>`.
- `_dashboard/recent-activity-panel.tsx` — `<th>Site</th>` → `<th>Resource</th>`.
- `admin/recordings/recordings-table.tsx` — `<option value="">All sites</option>` → `All resources`; `<th>Site</th>` → `<th>Resource</th>`.
- `admin/recordings/page.tsx` — "Replay captured vendor sessions on recorded **sites**." → "…on recorded **resources**.".

Connectors:
- `admin/connectors/[id]/page.tsx` — `<h2>Sites on this connector</h2>` → `<h2>Resources on this connector</h2>`; `<div className="empty">No sites yet.</div>` → `No resources yet.`; the sub-panel sub "Latest access decisions on its **sites**" → "…on its **resources**"; the audit `<th>Site</th>` → `<th>Resource</th>`. (Leave `sites: { select … }`.)
- `admin/connectors/connector-form.tsx` — "…remote-desktop **sites** (RDP/SSH/VNC) can reach it…" → "remote-desktop **resources**…"; "…define a **Site** (with its internal address) in the console…" → "…a **Resource**…".
- `admin/connectors/page.tsx` — "…**sites** to expose specific internal upstreams through it." → "…**resources** to expose…". (Leave `_count: { select: { sites: true } }`.)
- `admin/connectors/delete-connector-button.tsx` — `has_sites: "This connector still has sites — move or remove them under Sites first."` → `"This connector still has resources — move or remove them under Resources first."` (keep the `has_sites` key).
- `admin/connectors/repair-connector-button.tsx` — "…the connector keeps its identity and its **sites**." → "…its **resources**.".

Notifications / Policy / Directory / Access / Command palette / Dashboard:
- `admin/notifications/notifications-view.tsx` — `placeholder="Search site or detail…"` → `"Search resource or detail…"`; `<th>Site</th>` → `<th>Resource</th>`.
- `admin/notifications/page.tsx` — "**Site** down/recovered events from the health probe." → "**Resource** down/recovered events…".
- `admin/policy/platform-settings-form.tsx` — "On recorded **sites**, show the vendor…" → "On recorded **resources**…"; "**Site** up/down events POST here…" → "**Resource** up/down events…"; "vendors can reach published **sites** only from these networks" → "…published **resources**…".
- `admin/policy/page.tsx` — the value in `"site-health": "Site health"` → `"site-health": "Resource health"` (keep the `"site-health"` key).
- `admin/directory/directory-form.tsx` — "…map groups to roles or **sites**." → "…roles or **resources**.".
- `admin/directory/group-mappings.tsx` — the visible radio label `Site access` → `Resource access` (keep `kind === "SITE"`, `setKind("SITE")`, `name="gm-kind"`).
- `access/page.tsx` — "**Sites** you have been granted access to, and when that access applies." → "**Resources** you have been granted access to…".
- `access/access-view.tsx` — `<th>Site</th>` → `<th>Resource</th>`.
- `_shell/command-palette.tsx` — the label-map **value** `site: "Sites"` → `site: "Resources"` (keep the `site:` key); placeholder "Jump to a page, **site**, connector, or user…" → "…a page, **resource**, connector, or user…".
- `_dashboard/site-health-panel.tsx` — `<h2>Site health</h2>` → `<h2>Resource health</h2>`; `<div className="empty">No sites yet.</div>` → `No resources yet.`; `<th>Site</th>` → `<th>Resource</th>`. (Leave `site.probeOk`, `site.probedAt`, the component name `SiteHealthPanel`.)
- `_dashboard/stat-cards.tsx` — `"Sites reachable"` → `"Resources reachable"` (this file is no longer rendered, updated for consistency).
- `page.tsx` — the getting-started hint "Define a **Site** for an app the connector can reach." → "Define a **Resource** for an app…"; the grant hint "Tie a user to a **site** — optionally time-boxed…" → "…to a **resource** —…". (Keep both `href` values.)

> Leave code comments untouched (e.g. `site-avatar.tsx` "the Site name beside it" is a comment, not rendered).

- [ ] **Step 2: Verify build + tests**

Run: `pnpm build` — Expected: PASS (proves no identifier broke).
Run: `pnpm test` — Expected: all suites PASS (nothing logic changed).

- [ ] **Step 3: Grep audit — no rendered "Site/Sites" left**

Run:

```bash
grep -rniE "\bSites?\b" "src/app/(app)" \
  | grep -viE "siteId|siteName|site\.(name|id|probe|hostname|connector|description|upstream|accessMode)|/admin/sites|SitesIcon|SiteHealthPanel|SiteAccessMode|getSite|EditSiteButton|SitesView|: Site|Site\[\]|href=|push\(|htmlFor=|\bid=\"site|name=\"|value=\"|\"site-health\"|kind === \"SITE\"|setKind|_count|sites: \{|sites=\{|sites\.map|sites\.length|\{ sites|sites,|const \[|site-card|site-grid|site-avatar|// |/\*"
```

Expected: **no output** (every remaining `Site/Sites` match is an allowed identifier). If a rendered string appears, fix it and re-run.

- [ ] **Step 4: Commit**

```bash
git add -A "src/app/(app)"
git commit -m "refactor(ui): rename user-facing Sites to Resources (copy only)"
```

---

### Task 2: Docs prose rename

**Files:** `README.md`, `docs/how-it-works.md`, `docs/quickstart.md`, `docs/install.md` (and any other `docs/*.md` containing the term).

**Interfaces:** none (prose only). Verified by grep audit + eyeball.

- [ ] **Step 1: Rename the concept word in prose**

In each file, change the rendered term **Site/Sites → Resource/Resources** wherever it is prose referring to the console concept, including:
- Definitions and sentences: "A **Site** = which internal app…" → "A **Resource** = which internal app…"; "Define **a Site**" → "Define **a Resource**"; "Which **Site**?" → "Which **Resource**?"; "matched **Site**" / "no matching **Site**" → "matched **Resource**" / "no matching **Resource**"; "a **Site** = which internal app (e.g. `jira.access.yourdomain.com`…)" wording.
- Table headers and list items that read "Site".
- Mermaid node labels that read "Which Site?" → "Which Resource?" (labels only — keep node IDs like `M`).
- The nav/page reference "under **Sites**" → "under **Resources**" to match the console.

Keep unchanged: fenced code / config / command blocks that reference the route `/admin/sites`, API paths, field names (`siteId`), env vars, `ALLOWED_TARGETS`, and the literal word inside URLs/hostnames.

- [ ] **Step 2: Grep audit — no prose "Site/Sites" left**

Run:

```bash
grep -rniE "\bSites?\b" README.md docs/*.md \
  | grep -viE "website|/admin/sites|siteId|`[^`]*[Ss]ite|composite"
```

Review the output: every remaining match must be inside a code span / route / field reference that is intentionally kept. If a prose mention remains, fix it and re-run.

- [ ] **Step 3: Commit**

```bash
git add README.md docs
git commit -m "docs: rename user-facing Sites to Resources in prose"
```

- [ ] **Step 4: Gate A — live/rendered validation (operator, after deploy)**

- Console: the left nav reads **Resources**; `/admin/sites` still loads; its title/heading read **Resources** and the intro says "A resource is an internal upstream…"; the grants/audit/live/recordings/notifications/access columns and filters read **Resource**; connectors detail shows "Resources on this connector"; the dashboard shows the **Resource health** panel; the command palette lists **Resources**; directory shows "Resource access".
- Docs on GitHub read **Resource** throughout and still render (mermaid diagrams intact).

---

## Self-Review

**1. Spec coverage:**
- Console UI visible strings (nav, sites pages, site-form label, grants, audit, live, recent-activity, recordings, connectors ×5, notifications ×2, policy ×2 + slug value, directory ×2, access ×2, command palette, dashboard panels, stat-cards, page.tsx hints) → Task 1. ✓
- Docs prose (README, how-it-works, quickstart, install) → Task 2. ✓
- Route `/admin/sites`, identifiers, Prisma model kept → Global Constraints + explicit "Leave" notes on every affected line. ✓
- Verification (build, test, grep audit, Gate A) → Task 1 Steps 2-3 + Task 2 Steps 2 + Gate A. ✓

**2. Placeholder scan:** No TBD/TODO. Every UI edit names the exact file and the exact old→new string. Docs use a uniform transformation rule with an explicit keep-list and an audit gate — appropriate for prose where enumerating 70+ identical concept-word swaps line-by-line adds no precision the rule lacks.

**3. Type/identifier consistency:** No new identifiers introduced. Every listed edit changes rendered text or prose only; each line that also contains an identifier (`siteId`, `sites.map`, `htmlFor="site-name"`, `kind === "SITE"`, `"site-health"` key, component names, CSS classes) carries an explicit "keep/leave" note, and the audit greps exclude exactly those identifier patterns.
