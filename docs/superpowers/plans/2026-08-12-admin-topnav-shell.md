# Admin Top-Nav Shell Implementation Plan (Slice 2a-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin console's left sidebar with a grouped-dropdown top-nav, keeping every page reachable, capability-gated, searchable (⌘K), and mobile-friendly.

**Architecture:** A pure `buildNavModel(role, counts)` produces the capability-gated nav structure; a client `TopNav` renders it as a horizontal bar with two dropdown groups plus a right cluster (search/notifications/theme/account) and a mobile drawer; the app layout swaps from a sidebar grid to a top-nav column. Home page content is untouched (that's slice 2a-2).

**Tech Stack:** Next.js App Router (server layout + client nav), React, Vitest, TypeScript. No new dependencies.

## Global Constraints

- English-only UI copy. No Turkish.
- No database schema change. No new pages, no removed pages — this is chrome only.
- No Claude signature/trailer in commits.
- Reuse existing theme tokens (app is already teal-accented: `--accent:#0d9488`, `--nav-accent:#2ee6c9`, `--nav-bg`, `--nav-line`, `--mono`) — **no re-accent**.
- Capability gating via `can(role, cap)` from `@/lib/auth/roles` — `Capability = "configure" | "approve_grants" | "read_console"`; `Role` from `@/generated/prisma/enums`.
- Home page content unchanged (Insights redesign + relocation is slice 2a-2).
- Test runner: `pnpm test -- <path>` (vitest, colocated `*.test.ts`). Build gate: `pnpm build`.
- Existing pieces to reuse as-is: `CommandPalette({records, role})`, `ThemeSwitcher()` (no props), `LogoutButton()`, `UpdateBanner`, `BrandMark` from `@/components/brand`, `ROLE_LABELS`.
- Layout already gathers: `requireUser()`, `countPendingGrants()`, `countUnreadNotifications()`, `getSearchRecords()`, `getUpdateCheckConfig()`, `managerVersion()`, `isUpdateAvailable()`.

---

### Task 1: Nav model (pure, gated)

**Files:**
- Create: `src/lib/nav/model.ts`
- Test: `src/lib/nav/model.test.ts`

**Interfaces:**
- Consumes: `can`, `Role` from `@/lib/auth/roles` / `@/generated/prisma/enums`.
- Produces: `NavItem`, `NavGroup`, `NavModel`, `buildNavModel(role, counts)`.

- [ ] **Step 1: Write the failing test**

`src/lib/nav/model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildNavModel } from "./model";

describe("buildNavModel", () => {
  it("ADMIN: full primary + both groups + badges", () => {
    const m = buildNavModel("ADMIN", { pending: 3, unread: 5 });
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Recordings", "Audit"]);
    expect(m.primary.find((i) => i.label === "Access")?.badge).toBe(3);
    expect(m.groups.map((g) => g.label)).toEqual(["Infrastructure", "People"]);
    expect(m.groups[0].items).toHaveLength(8);
    expect(m.groups[1].items.map((i) => i.href)).toEqual(["/admin/users", "/admin/invites", "/admin/sessions"]);
    expect(m.showSearch).toBe(true);
    expect(m.showNotifications).toBe(true);
    expect(m.notificationsBadge).toBe(5);
  });
  it("OPERATOR: read-console + grants badge, no config groups, no Recordings", () => {
    const m = buildNavModel("OPERATOR", { pending: 2, unread: 0 });
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Audit"]);
    expect(m.primary.find((i) => i.label === "Access")?.badge).toBe(2);
    expect(m.groups).toEqual([]);
    expect(m.showSearch).toBe(true);
  });
  it("AUDITOR: read-console, no grants badge, no config groups", () => {
    const m = buildNavModel("AUDITOR", { pending: 9, unread: 1 });
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Audit"]);
    expect(m.primary.find((i) => i.label === "Access")?.badge).toBeUndefined();
    expect(m.groups).toEqual([]);
    expect(m.notificationsBadge).toBe(1);
  });
  it("VENDOR: empty (never in console)", () => {
    const m = buildNavModel("VENDOR", { pending: 0, unread: 0 });
    expect(m.primary).toEqual([]);
    expect(m.groups).toEqual([]);
    expect(m.showSearch).toBe(false);
    expect(m.showNotifications).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/nav/model.test.ts`
Expected: FAIL — cannot resolve `./model`.

- [ ] **Step 3: Write the implementation**

`src/lib/nav/model.ts`:

```ts
import { can } from "@/lib/auth/roles";
import type { Role } from "@/generated/prisma/enums";

export interface NavItem { label: string; href: string; badge?: number }
export interface NavGroup { label: string; items: NavItem[] }
export interface NavModel {
  primary: NavItem[];
  groups: NavGroup[];
  showSearch: boolean;
  showNotifications: boolean;
  notificationsBadge: number;
}

// Builds the capability-gated top-nav structure. Mirrors the previous sidebar's
// gating: read_console → Console/Access/Sessions/Audit + search + notifications;
// approve_grants → Access pending badge; configure → Recordings + Infrastructure
// + People. Empty groups are omitted; a 0 badge is left as undefined/0 for the
// renderer to suppress.
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

  const groups: NavGroup[] = [];
  if (config) {
    groups.push({ label: "Infrastructure", items: [
      { label: "Connectors", href: "/admin/connectors" },
      { label: "Resources", href: "/admin/sites" },
      { label: "Email", href: "/admin/email" },
      { label: "Single sign-on", href: "/admin/sso" },
      { label: "Directory", href: "/admin/directory" },
      { label: "Policy", href: "/admin/policy" },
      { label: "Custom domain", href: "/admin/domain" },
      { label: "Updates", href: "/admin/updates" },
    ] });
    groups.push({ label: "People", items: [
      { label: "Users", href: "/admin/users" },
      { label: "Invites", href: "/admin/invites" },
      { label: "Sessions", href: "/admin/sessions" },
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

Run: `pnpm test -- src/lib/nav/model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav/
git commit -m "feat(admin): capability-gated top-nav model"
```

---

### Task 2: TopNav component + styles

**Files:**
- Create: `src/app/(app)/_shell/topnav.tsx`
- Modify: `src/app/globals.css` (append `.topnav` styles)

**Interfaces:**
- Consumes: `NavModel` from `@/lib/nav/model`; `CommandPalette`, `ThemeSwitcher`, `LogoutButton`, `BrandMark`.
- Produces: `TopNav({ model, records, role, userName, roleLabel })` client component. Not yet wired into the layout (Task 3).

- [ ] **Step 1: Write the component**

Create `src/app/(app)/_shell/topnav.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import type { SearchRecord } from "@/lib/search";
import type { NavModel, NavGroup } from "@/lib/nav/model";
import { BrandMark } from "@/components/brand";
import { CommandPalette } from "./command-palette";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LogoutButton } from "../logout-button";

export function TopNav({ model, records, role, userName, roleLabel }: {
  model: NavModel; records: SearchRecord[]; role: Role; userName: string; roleLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null); // open dropdown label | "account" | null
  const [drawer, setDrawer] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const isActive = (href: string) => href === "/" ? pathname === "/" : (pathname === href || pathname.startsWith(`${href}/`));
  const groupActive = (g: NavGroup) => g.items.some((it) => isActive(it.href));

  // Close menus + drawer on navigation.
  useEffect(() => { setOpen(null); setDrawer(false); }, [pathname]);
  // Drive the CSS drawer via <html data-nav-open> (same mechanism the old sidebar used).
  useEffect(() => {
    document.documentElement.dataset.navOpen = drawer ? "1" : "";
    return () => { document.documentElement.dataset.navOpen = ""; };
  }, [drawer]);
  // Dismiss an open dropdown on outside-click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const initials = (userName.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase();

  return (
    <header className="topnav" ref={rootRef}>
      <button className="tn-burger" aria-label="Menu" aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}>
        <span /><span /><span />
      </button>
      <Link href="/" className="tn-brand">
        <BrandMark size={26} />
        <span className="tn-word"><b>Captivo</b> <span className="tn-sub">Access</span></span>
      </Link>

      <nav className="tn-primary">
        {model.primary.map((it) => (
          <Link key={it.href} href={it.href} className={isActive(it.href) ? "tn-link active" : "tn-link"} aria-current={isActive(it.href) ? "page" : undefined}>
            {it.label}{it.badge ? <span className="tn-badge">{it.badge}</span> : null}
          </Link>
        ))}
        {model.groups.map((g) => (
          <div key={g.label} className="tn-menuwrap">
            <button className={`tn-link tn-trigger${groupActive(g) ? " active" : ""}`} aria-haspopup="menu" aria-expanded={open === g.label} onClick={() => setOpen((v) => (v === g.label ? null : g.label))}>
              {g.label} <span className="tn-caret" aria-hidden="true">▾</span>
            </button>
            {open === g.label && (
              <div className="tn-menu" role="menu">
                {g.items.map((it) => (
                  <Link key={it.href} href={it.href} role="menuitem" className={isActive(it.href) ? "tn-menuitem active" : "tn-menuitem"}>{it.label}</Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="tn-right">
        {model.showSearch && <CommandPalette records={records} role={role} />}
        {model.showNotifications && (
          <Link href="/admin/notifications" className="tn-icon" aria-label="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            {model.notificationsBadge > 0 && <span className="tn-badge tn-badge-dot">{model.notificationsBadge}</span>}
          </Link>
        )}
        <ThemeSwitcher />
        <div className="tn-menuwrap tn-account">
          <button className="tn-avatar" aria-haspopup="menu" aria-expanded={open === "account"} onClick={() => setOpen((v) => (v === "account" ? null : "account"))}>
            {initials}
          </button>
          {open === "account" && (
            <div className="tn-menu tn-menu-right" role="menu">
              <div className="tn-ident"><b>{userName}</b><span>{roleLabel}</span></div>
              <Link href="/access" role="menuitem" className="tn-menuitem">My access</Link>
              <Link href="/settings/passkeys" role="menuitem" className="tn-menuitem">Settings</Link>
              <div className="tn-menu-foot"><LogoutButton /></div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile drawer (shown via html[data-nav-open] in CSS) */}
      <div className="tn-scrim" onClick={() => setDrawer(false)} />
      <div className="tn-drawer">
        {model.primary.map((it) => (
          <Link key={it.href} href={it.href} className={isActive(it.href) ? "tn-dlink active" : "tn-dlink"}>{it.label}{it.badge ? <span className="tn-badge">{it.badge}</span> : null}</Link>
        ))}
        {model.groups.map((g) => (
          <div key={g.label} className="tn-dgroup">
            <div className="tn-dgroup-label">{g.label}</div>
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className={isActive(it.href) ? "tn-dlink sub active" : "tn-dlink sub"}>{it.label}</Link>
            ))}
          </div>
        ))}
        <div className="tn-dgroup">
          <div className="tn-dgroup-label">Account</div>
          <Link href="/access" className="tn-dlink sub">My access</Link>
          <Link href="/settings/passkeys" className="tn-dlink sub">Settings</Link>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Append the top-nav styles**

Append to `src/app/globals.css` (a new `/* Admin top-nav */` section):

```css
/* Admin top-nav */
.topnav { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 1rem; height: 56px; padding: 0 20px; background: linear-gradient(180deg,var(--nav-bg),var(--nav-bg-2)); border-bottom: 1px solid var(--nav-line); }
.tn-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; flex: 0 0 auto; }
.tn-word { font-size: .95rem; color: var(--text); } .tn-word b { font-weight: 700; } .tn-sub { color: var(--text-dim); font-weight: 500; }
.tn-primary { display: flex; align-items: center; gap: 2px; }
.tn-menuwrap { position: relative; }
.tn-link { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px; font-size: .86rem; color: var(--text-dim); text-decoration: none; background: none; border: 0; cursor: pointer; font-family: inherit; white-space: nowrap; }
.tn-link:hover { color: var(--text); background: var(--nav-hover, rgba(255,255,255,.04)); }
.tn-link.active { color: var(--nav-accent); background: var(--nav-active); }
.tn-caret { font-size: .7em; opacity: .7; }
.tn-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 5px; border-radius: 99px; background: var(--accent); color: var(--accent-fg); font: 700 .62rem/1 var(--mono); }
.tn-menu { position: absolute; top: calc(100% + 6px); left: 0; min-width: 200px; display: flex; flex-direction: column; padding: 6px; gap: 2px; background: var(--surface, var(--nav-bg-2)); border: 1px solid var(--nav-line); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.4); }
.tn-menu-right { left: auto; right: 0; }
.tn-menuitem { padding: 8px 10px; border-radius: 8px; font-size: .85rem; color: var(--text-dim); text-decoration: none; }
.tn-menuitem:hover { color: var(--text); background: var(--nav-hover, rgba(255,255,255,.05)); }
.tn-menuitem.active { color: var(--nav-accent); background: var(--nav-active); }
.tn-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.tn-icon { position: relative; display: inline-flex; color: var(--text-dim); padding: 6px; border-radius: 8px; }
.tn-icon:hover { color: var(--text); background: var(--nav-hover, rgba(255,255,255,.05)); }
.tn-badge-dot { position: absolute; top: -2px; right: -2px; }
.tn-avatar { width: 32px; height: 32px; border-radius: 8px; border: 0; cursor: pointer; background: linear-gradient(135deg,var(--nav-accent),var(--accent-2)); color: #042420; font: 700 .74rem var(--mono); }
.tn-ident { display: flex; flex-direction: column; padding: 6px 10px 8px; border-bottom: 1px solid var(--nav-line); margin-bottom: 4px; }
.tn-ident b { font-size: .85rem; color: var(--text); } .tn-ident span { font-size: .72rem; color: var(--text-dim); }
.tn-menu-foot { padding-top: 6px; margin-top: 4px; border-top: 1px solid var(--nav-line); }
/* burger + drawer are mobile-only */
.tn-burger { display: none; flex-direction: column; gap: 4px; width: 34px; height: 34px; align-items: center; justify-content: center; background: none; border: 0; cursor: pointer; }
.tn-burger span { width: 18px; height: 2px; background: var(--text-dim); border-radius: 2px; }
.tn-scrim, .tn-drawer { display: none; }
@media (max-width: 900px) {
  .tn-primary { display: none; }
  .tn-burger { display: inline-flex; }
  .tn-scrim { display: block; position: fixed; inset: 56px 0 0; background: rgba(0,0,0,.5); opacity: 0; pointer-events: none; transition: opacity .15s; z-index: 39; }
  .tn-drawer { display: flex; flex-direction: column; gap: 2px; position: fixed; top: 56px; left: 0; bottom: 0; width: 260px; padding: 12px; overflow-y: auto; background: linear-gradient(180deg,var(--nav-bg),var(--nav-bg-2)); border-right: 1px solid var(--nav-line); transform: translateX(-100%); transition: transform .18s; z-index: 40; }
  :root[data-nav-open="1"] .tn-scrim { opacity: 1; pointer-events: auto; }
  :root[data-nav-open="1"] .tn-drawer { transform: none; }
  .tn-dlink { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; font-size: .9rem; color: var(--text-dim); text-decoration: none; }
  .tn-dlink.active { color: var(--nav-accent); background: var(--nav-active); }
  .tn-dlink.sub { padding-left: 22px; font-size: .85rem; }
  .tn-dgroup { margin-top: 8px; }
  .tn-dgroup-label { font: 600 .63rem/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--text-dim); padding: 8px 12px 4px; }
}
```

> Some token names (`--text`, `--text-dim`, `--nav-bg-2`, `--nav-active`, `--nav-hover`, `--surface`) may differ in this codebase. Before writing, open `src/app/globals.css` `:root` and confirm the actual token names for foreground text, dimmed text, the nav surface, and the active-nav background; substitute the real names. `--nav-accent`, `--accent`, `--accent-2`, `--accent-fg`, `--accent-soft`, `--nav-bg`, `--nav-line`, `--mono` are confirmed to exist.

- [ ] **Step 3: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully (TopNav exists but is not yet rendered — an unused export is fine).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/_shell/topnav.tsx" src/app/globals.css
git commit -m "feat(admin): TopNav component + styles"
```

---

### Task 3: Swap the shell to the top-nav

**Files:**
- Rewrite: `src/app/(app)/layout.tsx`
- Delete: `src/app/(app)/_shell/topbar.tsx`, `src/app/(app)/_shell/mobile-nav.tsx`, `src/app/(app)/nav-link.tsx`
- Modify: `src/app/globals.css` (add `.app`; remove dead sidebar rules)

**Interfaces:**
- Consumes: `buildNavModel` (Task 1), `TopNav` (Task 2).
- Produces: the live top-nav shell.

- [ ] **Step 1: Confirm the retired files have no other importers**

Run: `grep -rn "nav-link\|_shell/topbar\|_shell/mobile-nav" src/ | grep -v "src/app/(app)/layout.tsx"`
Expected: no matches (only the layout imports them). If any other file imports them, stop and report — those consumers must be handled first.

- [ ] **Step 2: Rewrite the layout to render TopNav**

Replace the whole of `src/app/(app)/layout.tsx`:

```tsx
import { requireUser } from "@/lib/current-user";
import { can, ROLE_LABELS } from "@/lib/auth/roles";
import { countPendingGrants } from "@/lib/access/grants";
import { countUnreadNotifications } from "@/lib/notifications";
import { getSearchRecords } from "@/lib/search";
import { UpdateBanner } from "@/app/(app)/_shell/update-banner";
import { getUpdateCheckConfig } from "@/lib/updates/update-check-config";
import { managerVersion } from "@/lib/version";
import { isUpdateAvailable } from "@/lib/updates/semver";
import { buildNavModel } from "@/lib/nav/model";
import { TopNav } from "./_shell/topnav";

// requireUser() must be read fresh from the DB on every request (session/role changes reflect immediately).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const showGrants = can(user.role, "approve_grants");
  const showRead = can(user.role, "read_console");
  const showConfig = can(user.role, "configure");
  const pending = showGrants ? await countPendingGrants() : 0;
  const unread = showRead ? await countUnreadNotifications() : 0;
  const searchRecords = showRead ? await getSearchRecords() : [];
  const mgr = managerVersion();
  const upd = showConfig ? await getUpdateCheckConfig() : null;
  const updateEnabled = upd?.enabled ?? false;
  const bannerLatest = upd && isUpdateAvailable(upd.latestVersion, mgr) ? upd.latestVersion : null;
  const DAY_MS = 24 * 60 * 60 * 1000;
  // eslint-disable-next-line react-hooks/purity
  const staleCheck = !!upd?.enabled && (upd.lastCheckedAt == null || Date.now() - upd.lastCheckedAt.getTime() > DAY_MS);

  const model = buildNavModel(user.role, { pending, unread });

  return (
    <div className="app">
      <TopNav model={model} records={searchRecords} role={user.role} userName={user.name} roleLabel={ROLE_LABELS[user.role] ?? user.role} />
      {showConfig && (
        <UpdateBanner
          enabled={updateEnabled}
          staleCheck={staleCheck}
          currentVersion={mgr}
          latestVersion={bannerLatest}
          latestUrl={upd?.latestUrl ?? null}
        />
      )}
      <main className="content">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Add the `.app` container rule**

In `src/app/globals.css`, add near the top-nav section:

```css
.app { display: flex; flex-direction: column; min-height: 100vh; min-width: 0; }
```

- [ ] **Step 4: Delete the retired components**

```bash
git rm "src/app/(app)/_shell/topbar.tsx" "src/app/(app)/_shell/mobile-nav.tsx" "src/app/(app)/nav-link.tsx"
```

- [ ] **Step 5: Remove dead sidebar CSS**

In `src/app/globals.css`, delete the now-unused sidebar/shell rules: `.app-shell`, `.sidebar`, `.nav-scroll` (+ its `::-webkit-scrollbar*`), `.nav-group`, `.nav-link` (the sidebar variant — note the top-nav uses `.tn-link`, so removing `.nav-link` is safe), `.nav-badge`, `.nav-foot`, `.nav-ident`, `.nav-av`, `.nav-id-text`, `.brand`/`.wordmark`/`.wm-sub` (sidebar brand), `.topbar`, and the `.app-shell`/sidebar-drawer rules inside the mobile `@media` block. For each selector, first `grep -n "<selector>" src/app/globals.css src -r` to confirm it isn't used by a surviving component; if a class is still referenced elsewhere, leave that rule. (Dead rules are harmless if missed, but the goal is a clean file.)

- [ ] **Step 6: Verify it builds**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(admin): swap sidebar shell for the top-nav; retire sidebar components"
```

---

### Task 4: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS (existing suite + the new nav-model test).

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: Compiles successfully.

- [ ] **Step 3: Manual test matrix (record results; deploy is a separate user-approved step — do not deploy here)**

1. ADMIN: top-nav shows Console · Access · Sessions · Recordings · Audit · Infrastructure ▾ · People ▾; right cluster shows search, notifications (with badge if unread), theme, avatar.
2. Dropdowns open on click, close on outside-click and `Esc`; each links to the right page; every one of the 8 Infrastructure + 3 People pages is reachable.
3. Active route highlights its primary item; a sub-page highlights its parent group trigger.
4. ⌘K still opens the command palette; grants pending badge shows on Access; theme toggle works; account menu → My access / Settings / Log out.
5. OPERATOR: Console · Access (badge) · Sessions · Audit only — no Recordings/Infrastructure/People. AUDITOR: same minus the Access badge.
6. Mobile (narrow width): hamburger opens a drawer listing all primary items + Infrastructure/People/Account sections; every page reachable; scrim closes it.
7. Home page content is unchanged from before this slice.

---

## Notes for the implementer

- `TopNav` is a client component; `CommandPalette`, `ThemeSwitcher`, and `LogoutButton` are already client components and render inside it unchanged.
- Do not change any page content or routes — this slice is chrome only. The #2a home composition is slice 2a-2.
- Keep the existing capability semantics exactly: read_console → Console/Access/Sessions/Audit + search + notifications; configure → Recordings + Infrastructure + People; approve_grants → Access pending badge.
