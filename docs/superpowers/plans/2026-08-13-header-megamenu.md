# Header Megamenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the admin console's Infrastructure and People header dropdowns into dark card megamenus — labeled columns of bordered cards (icon chip + label + one-line description).

**Architecture:** The nav model (`src/lib/nav/model.ts`) restructures each group from a flat `items[]` into labeled `columns`, and items gain optional `icon`/`desc`. A new `nav-icons.tsx` maps icon keys to inline SVG. `topnav.tsx` renders the group dropdowns as a `.tn-mega` card panel (click-to-open, unchanged interaction) and the mobile drawer gains column sub-headings; the account dropdown is restyled dark. CSS lives in `globals.css`.

**Tech Stack:** Next.js (App Router), React client component, TypeScript, vitest.

## Global Constraints

- **English only** — code, comments, commit messages. **No Claude signature.**
- **Manager-only**, no schema, no dataplane, no connector. Ships as **v0.54.0**.
- **Interaction stays click-to-open** — existing `setOpen` toggle + outside-click + Escape + close-on-navigation. No hover-intent.
- Hrefs, capability gating (`configure` for groups, `read_console` for primary/search/notifications, `approve_grants` for the Access badge), and the Access pending badge are **unchanged**.
- Functional accent stays teal (`--nav-accent:#2ee6c9`); the brand gradient is not used in the menu.
- Panels are **fixed dark** (hardcoded hex + nav tokens), cohesive with the navy nav island.
- Verify with `pnpm test` and `pnpm build` (no `grep` pipe — capture the exit code).

---

### Task 1: Nav model → labeled columns + icon/desc

**Files:**
- Modify: `src/lib/nav/model.ts` (whole file)
- Test: `src/lib/nav/model.test.ts` (update group assertions)

**Interfaces:**
- Produces: `NavIconKey` (11-key union), `NavItem { label; href; badge?; icon?: NavIconKey; desc? }`, `NavColumn { heading; items: NavItem[] }`, `NavGroup { label; columns: NavColumn[] }`, `NavModel` (unchanged fields, `groups: NavGroup[]`), `buildNavModel(role, counts): NavModel`.
- Consumes: `can` (`@/lib/auth/roles`), `Role` (`@/generated/prisma/enums`).

- [ ] **Step 1: Update the test to the columns shape**

Replace the two group assertions in `src/lib/nav/model.test.ts`. In the `ADMIN` test, replace lines asserting `m.groups[0].items` / `m.groups[1].items` with:

```ts
    expect(m.groups.map((g) => g.label)).toEqual(["Infrastructure", "People"]);
    // Infrastructure: 3 labeled columns
    expect(m.groups[0].columns.map((c) => c.heading)).toEqual(["Connectivity", "Identity & access", "Platform"]);
    expect(m.groups[0].columns.flatMap((c) => c.items).map((i) => i.href)).toEqual([
      "/admin/connectors", "/admin/sites", "/admin/domain",
      "/admin/directory", "/admin/sso", "/admin/policy",
      "/admin/email", "/admin/updates",
    ]);
    // every Infrastructure item carries an icon + description
    expect(m.groups[0].columns.flatMap((c) => c.items).every((i) => i.icon && i.desc)).toBe(true);
    // People: 1 column of 3
    expect(m.groups[1].columns).toHaveLength(1);
    expect(m.groups[1].columns[0].heading).toBe("Team & sessions");
    expect(m.groups[1].columns[0].items.map((i) => i.href)).toEqual(["/admin/users", "/admin/invites", "/admin/sessions"]);
```

The `OPERATOR`/`AUDITOR`/`VENDOR` tests already assert `m.groups` equals `[]` or map labels only — leave them as-is.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/nav/model.test.ts`
Expected: FAIL — `columns` is undefined on the current `NavGroup` (still `items`).

- [ ] **Step 3: Rewrite the model**

Replace the whole `src/lib/nav/model.ts` with:

```ts
import { can } from "@/lib/auth/roles";
import type { Role } from "@/generated/prisma/enums";

export type NavIconKey =
  | "connectors" | "resources" | "domain"
  | "directory" | "sso" | "policy"
  | "email" | "updates"
  | "users" | "invites" | "opsessions";

export interface NavItem { label: string; href: string; badge?: number; icon?: NavIconKey; desc?: string }
export interface NavColumn { heading: string; items: NavItem[] }
export interface NavGroup { label: string; columns: NavColumn[] }
export interface NavModel {
  primary: NavItem[];
  groups: NavGroup[];
  showSearch: boolean;
  showNotifications: boolean;
  notificationsBadge: number;
}

// Builds the capability-gated top-nav structure. read_console → Console/Access/
// Sessions/Audit/Insights + search + notifications; approve_grants → Access
// pending badge; configure → Recordings (primary) + the Infrastructure & People
// megamenu groups. Group items carry an icon + one-line description for the card
// megamenu; primary items stay plain links. Empty groups are omitted; a 0 badge
// is left undefined for the renderer to suppress.
export function buildNavModel(role: Role, counts: { pending: number; unread: number }): NavModel {
  const read = can(role, "read_console");
  const config = can(role, "configure");
  const grants = can(role, "approve_grants");

  const primary: NavItem[] = [];
  if (read) {
    primary.push({ label: "Console", href: "/" });
    primary.push({ label: "Access", href: "/admin/grants", badge: grants && counts.pending > 0 ? counts.pending : undefined });
    primary.push({ label: "Sessions", href: "/admin/live" });
  }
  if (config) primary.push({ label: "Recordings", href: "/admin/recordings" });
  if (read) primary.push({ label: "Audit", href: "/admin/audit" });
  if (read) primary.push({ label: "Insights", href: "/admin/insights" });

  const groups: NavGroup[] = [];
  if (config) {
    groups.push({ label: "Infrastructure", columns: [
      { heading: "Connectivity", items: [
        { label: "Connectors", href: "/admin/connectors", icon: "connectors", desc: "Outbound agents linking your sites" },
        { label: "Resources", href: "/admin/sites", icon: "resources", desc: "Hosts & apps vendors can reach" },
        { label: "Custom domain", href: "/admin/domain", icon: "domain", desc: "Your own hostname for the portal" },
      ] },
      { heading: "Identity & access", items: [
        { label: "Directory", href: "/admin/directory", icon: "directory", desc: "Sync users from your IdP groups" },
        { label: "Single sign-on", href: "/admin/sso", icon: "sso", desc: "OIDC login for your operators" },
        { label: "Policy", href: "/admin/policy", icon: "policy", desc: "Access rules, approvals & limits" },
      ] },
      { heading: "Platform", items: [
        { label: "Email", href: "/admin/email", icon: "email", desc: "SMTP for invites & notifications" },
        { label: "Updates", href: "/admin/updates", icon: "updates", desc: "New releases & changelog" },
      ] },
    ] });
    groups.push({ label: "People", columns: [
      { heading: "Team & sessions", items: [
        { label: "Users", href: "/admin/users", icon: "users", desc: "Operators & their roles" },
        { label: "Invites", href: "/admin/invites", icon: "invites", desc: "Pending & sent invitations" },
        { label: "Sessions", href: "/admin/sessions", icon: "opsessions", desc: "Signed-in operator sessions" },
      ] },
    ] });
  }

  return {
    primary,
    groups,
    showSearch: read,
    showNotifications: read,
    notificationsBadge: read ? counts.unread : 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/nav/model.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav/model.ts src/lib/nav/model.test.ts
git commit -m "feat(nav): model groups as labeled columns with icon + description"
```

---

### Task 2: `NavIcon` component

**Files:**
- Create: `src/app/(app)/_shell/nav-icons.tsx`

**Interfaces:**
- Consumes: `NavIconKey` (`@/lib/nav/model`, Task 1).
- Produces: `NavIcon({ name }: { name: NavIconKey })` → inline SVG element (16px, `currentColor` stroke). Renders nothing for an unknown key (defensive; not expected).

- [ ] **Step 1: Write the component**

Create `src/app/(app)/_shell/nav-icons.tsx`:

```tsx
import type { NavIconKey } from "@/lib/nav/model";

// Inline stroke icons for the header megamenu cards. 16px, currentColor so the
// card's teal ink applies. One entry per NavIconKey; no external icon library.
const PATHS: Record<NavIconKey, React.ReactNode> = {
  connectors: (<><path d="M9 2v6M15 2v6M9 8h6a4 4 0 0 1 4 4 6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6 4 4 0 0 1 4-4Z" /><path d="M12 18v4" /></>),
  resources: (<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>),
  domain: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>),
  directory: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" /></>),
  sso: (<><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 8-8M18 3l3 3M15 6l3 3" /></>),
  policy: (<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>),
  email: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  updates: (<><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>),
  invites: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>),
  opsessions: (<><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>),
};

export function NavIcon({ name }: { name: NavIconKey }) {
  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build` (capture the exit code, e.g. `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?`)
Expected: Compiles (component is not yet imported anywhere — build must still pass).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/_shell/nav-icons.tsx"
git commit -m "feat(nav): NavIcon inline-SVG map for megamenu cards"
```

---

### Task 3: Render the card megamenu + dark account menu + drawer columns

**Files:**
- Modify: `src/app/(app)/_shell/topnav.tsx`

**Interfaces:**
- Consumes: `NavModel`, `NavGroup` (`@/lib/nav/model`, updated Task 1 — now `columns`); `NavIcon` (`@/app/(app)/_shell/nav-icons`, Task 2); the `.tn-mega*` and drawer/account classes (Task 4).
- Produces: the rendered megamenu; no exported API change (`TopNav` props unchanged).

- [ ] **Step 1: Import NavIcon**

In `src/app/(app)/_shell/topnav.tsx`, add after the existing `import type { NavModel, NavGroup } from "@/lib/nav/model";` line:

```tsx
import { NavIcon } from "./nav-icons";
```

- [ ] **Step 2: Update `groupActive` to read columns**

Replace:

```tsx
  const groupActive = (g: NavGroup) => g.items.some((it) => isActive(it.href));
```

with:

```tsx
  const groupActive = (g: NavGroup) => g.columns.some((c) => c.items.some((it) => isActive(it.href)));
```

- [ ] **Step 3: Replace the desktop group dropdown body with the megamenu**

In the `.tn-primary` nav, replace the whole open-dropdown block:

```tsx
            {open === g.label && (
              <div className="tn-menu" role="menu">
                {g.items.map((it) => (
                  <Link key={it.href} href={it.href} role="menuitem" className={isActive(it.href) ? "tn-menuitem active" : "tn-menuitem"}>{it.label}</Link>
                ))}
              </div>
            )}
```

with:

```tsx
            {open === g.label && (
              <div className="tn-mega" role="menu">
                <div className="tn-mega-cols" data-cols={g.columns.length}>
                  {g.columns.map((col) => (
                    <div key={col.heading} className="tn-mega-col">
                      <p className="tn-mega-h">{col.heading}</p>
                      {col.items.map((it) => (
                        <Link key={it.href} href={it.href} role="menuitem" className={isActive(it.href) ? "tn-mega-card active" : "tn-mega-card"}>
                          <span className="tn-mega-ic">{it.icon ? <NavIcon name={it.icon} /> : null}</span>
                          <span className="tn-mega-nm">{it.label}</span>
                          <span className="tn-mega-ds">{it.desc}</span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
```

- [ ] **Step 4: Replace the mobile drawer group block with column sub-headings**

In the `.tn-drawer`, replace:

```tsx
        {model.groups.map((g) => (
          <div key={g.label} className="tn-dgroup">
            <div className="tn-dgroup-label">{g.label}</div>
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className={isActive(it.href) ? "tn-dlink sub active" : "tn-dlink sub"}>{it.label}</Link>
            ))}
          </div>
        ))}
```

with:

```tsx
        {model.groups.map((g) => (
          <div key={g.label} className="tn-dgroup">
            <div className="tn-dgroup-label">{g.label}</div>
            {g.columns.map((col) => (
              <div key={col.heading} className="tn-dcol">
                <div className="tn-dcol-label">{col.heading}</div>
                {col.items.map((it) => (
                  <Link key={it.href} href={it.href} className={isActive(it.href) ? "tn-dlink sub active" : "tn-dlink sub"}>{it.label}</Link>
                ))}
              </div>
            ))}
          </div>
        ))}
```

- [ ] **Step 5: Verify it builds**

Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?`
Expected: `EXIT=0`. The account menu still uses `.tn-menu`/`.tn-menuitem` (unchanged JSX); only the group dropdowns switched to `.tn-mega`. (Cards are unstyled until Task 4 — that's fine, build only typechecks.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/_shell/topnav.tsx"
git commit -m "feat(nav): render group dropdowns as card megamenu + drawer columns"
```

---

### Task 4: Megamenu CSS + dark account menu + drawer sub-columns

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: nav tokens `--nav-bg`/`--nav-fg`/`--nav-fg-dim`/`--nav-line`/`--nav-active`/`--nav-accent`, `--mono`. Classes referenced by Task 3: `.tn-mega`, `.tn-mega-cols`, `.tn-mega-col`, `.tn-mega-h`, `.tn-mega-card`, `.tn-mega-ic`, `.tn-mega-nm`, `.tn-mega-ds`, `.tn-dcol`, `.tn-dcol-label`.
- Produces: styled dark megamenu + dark account dropdown.

- [ ] **Step 1: Add the `.tn-mega` block**

In `src/app/globals.css`, immediately **after** the `.tn-menu.active` / `.tn-menuitem.active` rules (the block around `.tn-menuitem { … } .tn-menuitem:hover { … } .tn-menuitem.active { … }`, near line 690), insert:

```css
/* ---- header card megamenu (Infrastructure / People) ---- */
.tn-mega { position: absolute; top: calc(100% + 8px); left: 0; z-index: 50; padding: 18px 20px;
  background: #0d1626; border: 1px solid #1e3050; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.55); }
.tn-mega::before { content: ""; position: absolute; top: -7px; left: 26px; width: 12px; height: 12px;
  background: #0d1626; border-left: 1px solid #1e3050; border-top: 1px solid #1e3050; transform: rotate(45deg); }
.tn-mega-cols { display: grid; gap: 20px; }
.tn-mega-cols[data-cols="3"] { grid-template-columns: repeat(3, minmax(190px, 1fr)); }
.tn-mega-cols[data-cols="1"] { grid-template-columns: minmax(240px, 1fr); }
.tn-mega-h { font: 600 .63rem/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: #61748f;
  margin: 0 0 6px; padding: 0 2px 10px; border-bottom: 1px solid #1e3050; }
.tn-mega-card { display: block; padding: 12px; margin-bottom: 9px; border: 1px solid #1e3050; border-radius: 11px;
  background: #0a1220; text-decoration: none; transition: border-color .12s, transform .12s, background .12s; }
.tn-mega-card:last-child { margin-bottom: 0; }
.tn-mega-card:hover, .tn-mega-card.active { border-color: rgba(46,230,201,.4); background: #0c1626; }
.tn-mega-card:hover { transform: translateY(-1px); }
.tn-mega-ic { display: grid; place-items: center; width: 32px; height: 32px; margin-bottom: 9px; border-radius: 9px;
  background: rgba(46,230,201,.1); border: 1px solid rgba(46,230,201,.2); color: var(--nav-accent); }
.tn-mega-nm { display: block; font-size: .87rem; font-weight: 600; color: #e8edf5; line-height: 1.2; }
.tn-mega-card:hover .tn-mega-nm, .tn-mega-card.active .tn-mega-nm { color: var(--nav-accent); }
.tn-mega-ds { display: block; font-size: .73rem; color: #6f809a; line-height: 1.35; margin-top: 3px; }
```

- [ ] **Step 2: Darken the account dropdown**

The account menu is the only remaining `.tn-menu` user. Find the existing rules (near line 686):

```css
.tn-menu { position: absolute; top: calc(100% + 6px); left: 0; min-width: 200px; display: flex; flex-direction: column; padding: 6px; gap: 2px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); }
```

Change **only** its `background` and `border` to the dark panel:

```css
.tn-menu { position: absolute; top: calc(100% + 6px); left: 0; min-width: 200px; display: flex; flex-direction: column; padding: 6px; gap: 2px; background: #0d1626; border: 1px solid #1e3050; border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.55); }
```

Then replace the `.tn-menuitem`, `.tn-menuitem:hover`, `.tn-menuitem.active` rules:

```css
.tn-menuitem { padding: 8px 10px; border-radius: 8px; font-size: .85rem; color: var(--nav-fg); text-decoration: none; }
.tn-menuitem:hover { color: #fff; background: var(--nav-active); }
.tn-menuitem.active { color: var(--nav-accent); background: var(--nav-active); }
```

And the identity + footer rules (near line 696-698):

```css
.tn-ident { display: flex; flex-direction: column; padding: 6px 10px 8px; border-bottom: 1px solid var(--nav-line); margin-bottom: 4px; }
.tn-ident b { font-size: .85rem; color: #fff; } .tn-ident span { font-size: .72rem; color: var(--nav-fg-dim); }
.tn-menu-foot { padding-top: 6px; margin-top: 4px; border-top: 1px solid var(--nav-line); }
```

(Leave `.tn-menu-right { left: auto; right: 0; }` unchanged — the account menu uses it.)

- [ ] **Step 3: Add drawer sub-column styles**

In the mobile `@media (max-width: …)` block that defines `.tn-dgroup-label` (near line 713), add after it:

```css
  .tn-dcol { margin-bottom: 2px; }
  .tn-dcol-label { font: 600 .6rem/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--nav-fg-dim); padding: 6px 12px 2px; }
```

- [ ] **Step 4: Verify build + full suite**

Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?` → `EXIT=0`
Run: `pnpm test > /tmp/t.log 2>&1; echo EXIT=$?` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(nav): dark card-megamenu styles + dark account menu + drawer columns"
```

---

### Task 5: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test > /tmp/t.log 2>&1; echo EXIT=$?` → `EXIT=0` (model test updated; no other test touches nav shape).
- [ ] **Step 2: Build** — Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?` → `EXIT=0`.
- [ ] **Step 3: Manual (Gate A, after deploy):**
  1. Sign in as an admin (`configure` capability). Click **Infrastructure** → a dark 3-column card megamenu drops down with a caret to the trigger: *Connectivity* / *Identity & access* / *Platform*, each card shows icon chip + label + description; hover turns border/name teal; the current page's card is highlighted.
  2. Click **People** → a single-column card megamenu (*Team & sessions*, 3 cards).
  3. Click a card → navigates and the menu closes. Click-away and Escape both close the open menu.
  4. Open the **account** (avatar) dropdown → it is dark, matching the nav; items/hover/active legible; logout in the footer.
  5. Narrow the viewport → the burger drawer shows each group label, its column sub-headings, and item links (no descriptions/icons).
  6. Toggle app light/dark theme → the nav and both menus stay dark and legible (fixed frame).
  7. Sign in as an **operator/auditor** (no `configure`) → no Infrastructure/People triggers appear (groups empty); primary links, search, notifications still present.

---

## Notes for the implementer

- The megamenu is **fixed dark** by design (hardcoded hex + nav tokens), not theme-token driven — correct, not a theme bug.
- Don't switch to hover-open — the existing click + outside-click + Escape model is intentional and accessible.
- `data-cols` on `.tn-mega-cols` is what sizes the grid (3 vs 1). Keep it in sync with `g.columns.length` (already wired in Task 3).
- Deploy: **v0.54.0, manager-only** — bump the manager image tag, `docker compose pull access-manager` + `up -d access-manager`, verify `/login` 200 (`-H "Host: manager.access.captivo.io"` on `127.0.0.1:3100`) + `docker exec cap-access-manager sh -c 'echo $APP_VERSION'`, then Gate A, then `gh release edit v0.54.0` with an English user-facing note.
```
