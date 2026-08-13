# Header Megamenu — Design

**Status:** Approved (brainstorm 2026-08-13). Direction B (bordered cards), dark panel, labeled columns.
**Backlog:** punch-list #12.
**Ships as:** v0.54.0 (manager only; frontend + nav model, no schema).
**Source:** mockup `Direction B` (compact-rows vs cards comparison, approved).

## Goal

Turn the admin console's two header dropdowns (**Infrastructure**, **People**) from
plain single-column link lists into **card megamenus**: a dark panel of labeled
columns where each item is a bordered card with an icon chip, label, and one-line
description. The panels stay cohesive with the navy nav island. No behavioural
change to what the links point at — only how the menu looks and is structured.

## Nav data model — `src/lib/nav/model.ts`

Groups move from a flat `items[]` to **labeled columns**, and items gain optional
`icon` + `desc`:

```ts
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
```

`primary` items keep using `NavItem` without `icon`/`desc` (flat links). Only
group-column items carry `icon` + `desc`.

**`buildNavModel(role, counts)` group output (only when `config` capability):**

```
Infrastructure:
  Connectivity      → Connectors (connectors, "Outbound agents linking your sites")
                      Resources (resources, "Hosts & apps vendors can reach")
                      Custom domain (domain, "Your own hostname for the portal")
  Identity & access → Directory (directory, "Sync users from your IdP groups")
                      Single sign-on (sso, "OIDC login for your operators")
                      Policy (policy, "Access rules, approvals & limits")
  Platform          → Email (email, "SMTP for invites & notifications")
                      Updates (updates, "New releases & changelog")

People:
  Team & sessions   → Users (users, "Operators & their roles")
                      Invites (invites, "Pending & sent invitations")
                      Sessions (opsessions, "Signed-in operator sessions")
```

Hrefs are unchanged from today: `/admin/connectors`, `/admin/sites`,
`/admin/domain`, `/admin/directory`, `/admin/sso`, `/admin/policy`,
`/admin/email`, `/admin/updates`, `/admin/users`, `/admin/invites`,
`/admin/sessions`.

Gating is unchanged: both groups appear only under the `configure` capability;
`read_console` still drives primary/search/notifications; `approve_grants` still
drives the Access pending badge (a primary item, untouched).

## Icons — `src/app/(app)/_shell/nav-icons.tsx`

A new client module exporting `NavIcon({ name }: { name: NavIconKey })` → inline
stroke SVG (16px, `currentColor`, `stroke-width 2`, round caps), one per key.
Icons match the approved mockup: plug (connectors), stacked racks (resources),
globe (domain), users-group (directory), key (sso), shield-check (policy),
envelope (email), download (updates), users (users), user-plus (invites),
activity-line (opsessions). No external icon lib.

## Rendering — `src/app/(app)/_shell/topnav.tsx`

Replace the group dropdown body (currently `.tn-menu` with `.tn-menuitem`
links) with the card megamenu when a group is open:

```tsx
{open === g.label && (
  <div className="tn-mega" role="menu">
    <div className="tn-mega-cols" data-cols={g.columns.length}>
      {g.columns.map((col) => (
        <div key={col.heading} className="tn-mega-col">
          <p className="tn-mega-h">{col.heading}</p>
          {col.items.map((it) => (
            <Link key={it.href} href={it.href} role="menuitem"
              className={isActive(it.href) ? "tn-mega-card active" : "tn-mega-card"}>
              <span className="tn-mega-ic"><NavIcon name={it.icon!} /></span>
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

Interaction is unchanged from today: **click-to-open** the trigger button
(`setOpen` toggle), close on outside-click or Escape (existing effects), close
on navigation (existing `pathname` effect). `groupActive(g)` becomes
`g.columns.some((c) => c.items.some((it) => isActive(it.href)))`. No hover-open.

`data-cols` drives column count for width (3 for Infrastructure, 1 for People).

**Account menu:** still rendered with `.tn-menu`/`.tn-menuitem` (a small utility
menu, not a megamenu). Its panel is **restyled dark** (see CSS) so nothing
hanging off the navy nav is light-on-dark.

## Mobile drawer — `topnav.tsx`

The existing `.tn-drawer` keeps its flat per-group layout, now driven by columns:
for each group, render the group label, then for each column its `col.heading` as
a sub-label followed by the column's item links (label only). **Descriptions and
icons are omitted in the drawer** to stay compact.

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

## CSS — `src/app/globals.css`

New `.tn-mega*` block (dark panel, tokens from the approved mockup):

- `.tn-mega` — absolute under trigger, `top: calc(100% + 8px) left: 0`,
  bg `#0d1626`, border `1px #1e3050`, radius 14, shadow `0 24px 60px rgba(0,0,0,.55)`,
  padding `18px 20px`, `z-index: 50`. A `::before` caret triangle (7px, same
  bg/border) at `top:-7px left:26px`.
- `.tn-mega-cols` — `display:grid; gap:20px;`
  `&[data-cols="3"]{grid-template-columns:repeat(3,minmax(190px,1fr));}`
  `&[data-cols="1"]{grid-template-columns:minmax(240px,1fr);}`
- `.tn-mega-h` — mono `.63rem`, letter-spacing `.16em`, uppercase, color `#61748f`,
  `padding-bottom:10px; margin-bottom:6px; border-bottom:1px solid #1e3050`.
- `.tn-mega-card` — `display:block; padding:12px; border:1px solid #1e3050;`
  `border-radius:11px; background:#0a1220; text-decoration:none; margin-bottom:9px;`
  transitions on border/transform/background.
- `.tn-mega-card:hover` — border `rgba(46,230,201,.4)`, bg `#0c1626`,
  `transform:translateY(-1px)`.
- `.tn-mega-card.active` — border `rgba(46,230,201,.4)`, bg `#0c1626`; `.tn-mega-nm`
  teal.
- `.tn-mega-ic` — 32px chip, radius 9, bg `rgba(46,230,201,.1)`, border
  `rgba(46,230,201,.2)`, teal icon, `margin-bottom:9px`; svg 16px.
- `.tn-mega-nm` — `.87rem`, weight 600, `#e8edf5`; card hover/active → `--nav-accent`.
- `.tn-mega-ds` — `.73rem`, `#6f809a`, line-height 1.35, `margin-top:3px`.

**Account menu dark restyle** (only affects the avatar dropdown now that groups
use `.tn-mega`):
- `.tn-menu` — bg `#0d1626`, border `1px #1e3050`, shadow unchanged.
- `.tn-menuitem` — color `var(--nav-fg)`; hover bg `var(--nav-active)`, color `#fff`;
  `.active` color `var(--nav-accent)`, bg `var(--nav-active)`.
- `.tn-ident b` white, `.tn-ident span` `var(--nav-fg-dim)`.
- `.tn-menu-foot` border-top `var(--nav-line)`.

**Drawer sub-columns:**
- `.tn-dcol-label` — mono `.6rem`, letter-spacing `.14em`, uppercase,
  `var(--nav-fg-dim)`, `padding:6px 12px 2px`.
- `.tn-dcol` — `margin-bottom:2px`.

Remove the now-unused `.tn-menu-right` only if nothing references it — the account
menu still uses `tn-menu-right`, so **keep it**.

## Non-goals / guardrails

- **No schema, no dataplane, no connector.** Manager only.
- Hrefs, capability gating, and the Access pending badge are unchanged.
- **Interaction stays click-to-open** (existing a11y model); no hover-intent.
- The functional accent stays teal; the brand gradient is not used here.
- Primary links, search, notifications, live pill, theme switcher — untouched.

## Testing

- `src/lib/nav/model.test.ts` — update to the columns shape: assert Infrastructure
  has 3 columns with the expected headings and that flattened items still map to
  the same hrefs; People has 1 column of 3; groups absent without `configure`.
- `pnpm build` — typechecks the model change, `NavIcon`, and the topnav rewrite.
- `pnpm test` — full suite green.
- Gate A (after deploy): open Infrastructure → 3-column card megamenu, dark panel,
  caret to trigger, teal hover, active item highlighted; open People → 1 column;
  account dropdown is dark; click-away + Escape close; navigate closes; mobile
  drawer shows group + column sub-headings (no descriptions); light/dark app theme
  both fine (nav is fixed dark).

## Deploy

**v0.54.0**, manager only. Bump the manager tag, `docker compose up -d access-manager`,
verify `/login` 200 + `APP_VERSION`, then Gate A, then English `gh release edit` note.
