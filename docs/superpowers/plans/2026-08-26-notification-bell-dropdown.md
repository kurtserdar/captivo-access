# Notification Bell Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the header notification bell open a dropdown panel (recent unread notifications with per-item mark-read/delete + "mark all read" + a link to the full page) instead of navigating straight to `/admin/notifications`.

**Architecture:** A new client `NotificationBell` component replaces the bell `<Link>` in the topnav; it fetches from a new `GET /api/admin/notifications` list endpoint and acts via the existing mark-read routes plus a new `DELETE /api/admin/notifications/[id]`. Opening the panel never auto-marks read; after any action the component calls `router.refresh()` so the server-rendered badge updates.

**Tech Stack:** Next.js 16 (App Router, client components), Prisma, React.

## Global Constraints

- **English only** — code, comments, UI strings, commit messages, release notes.
- **No Claude signature** in commits.
- **Manager-only** — no schema change, no dataplane/connector, no `db push`.
- All endpoints `read_console`-gated (consistent with existing mark-read routes).
- **Opening the panel does NOT auto-mark anything read** — the badge changes only on an explicit action.
- Notification model fields: `{ id, type ("site_down"|"site_recovered"), siteName, detail?, createdAt, readAt? }`.
- Do NOT deploy or write release notes without explicit user approval.

---

### Task 1: List endpoint — `GET /api/admin/notifications`

**Files:**
- Create: `src/app/api/admin/notifications/route.ts`

**Interfaces:**
- Produces: `GET` returns `{ items: { id, type, siteName, detail, when }[], unread: number }` — the 8 most recent UNREAD notifications + the full unread count. Consumed by Task 3.

- [ ] **Step 1: Implement the GET handler.** Create `src/app/api/admin/notifications/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [rows, unread] = await Promise.all([
    db.notification.findMany({
      where: { readAt: null },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, siteName: true, detail: true, createdAt: true },
    }),
    db.notification.count({ where: { readAt: null } }),
  ]);

  return NextResponse.json({
    items: rows.map((n) => ({ id: n.id, type: n.type, siteName: n.siteName ?? "—", detail: n.detail, when: timeAgo(n.createdAt) })),
    unread,
  });
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/admin/notifications/route.ts
git commit -m "feat(notifications): GET list endpoint for the bell dropdown"
```

---

### Task 2: Delete endpoint — `DELETE /api/admin/notifications/[id]`

**Files:**
- Create: `src/app/api/admin/notifications/[id]/route.ts`

**Interfaces:**
- Produces: `DELETE` permanently removes one notification. Consumed by Task 3.

- [ ] **Step 1: Implement the DELETE handler.** Create `src/app/api/admin/notifications/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  // deleteMany (not delete) so a double-delete returns ok, not a 500 on missing row.
  await db.notification.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

(Note: `[id]/read/route.ts` already exists with its own `POST`; this new sibling `[id]/route.ts` adds `DELETE` — no conflict, different files.)

- [ ] **Step 2: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add "src/app/api/admin/notifications/[id]/route.ts"
git commit -m "feat(notifications): DELETE endpoint to remove one notification"
```

---

### Task 3: `NotificationBell` client component

**Files:**
- Create: `src/app/(app)/_shell/notification-bell.tsx`
- Modify: `src/app/(app)/globals.css` (panel styles)

**Interfaces:**
- Consumes: `GET /api/admin/notifications` (Task 1), `POST /api/admin/notifications/read`, `POST /api/admin/notifications/[id]/read`, `DELETE /api/admin/notifications/[id]` (Task 2).
- Produces: `NotificationBell` — props `{ badge: number; open: boolean; onToggle: () => void }`. Consumed by Task 4.

- [ ] **Step 1: Create the component.** Create `src/app/(app)/_shell/notification-bell.tsx`:

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Item = { id: string; type: string; siteName: string; detail: string | null; when: string };

const TITLE: Record<string, string> = { site_down: "Resource down", site_recovered: "Resource recovered" };

export function NotificationBell({ badge, open, onToggle }: { badge: number; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(badge);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { items: Item[]; unread: number };
      setItems(body.items);
      setUnread(body.unread);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Any mutation: refresh the panel list AND the server-rendered badge.
  async function act(url: string, method: "POST" | "DELETE") {
    await fetch(url, { method }).catch(() => {});
    await load();
    router.refresh();
  }

  return (
    <div className="tn-menuwrap tn-notif">
      <button className="tn-icon" aria-haspopup="menu" aria-expanded={open} aria-label="Notifications" onClick={onToggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        {badge > 0 && <span className="tn-badge tn-badge-dot">{badge}</span>}
      </button>
      {open && (
        <div className="tn-menu tn-notif-panel" role="menu">
          <div className="tn-notif-head">
            <span>Notifications</span>
            {items.length > 0 && (
              <button className="tn-notif-link" onClick={() => void act("/api/admin/notifications/read", "POST")}>Mark all read</button>
            )}
          </div>
          <div className="tn-notif-list">
            {loading && items.length === 0 ? (
              <div className="tn-notif-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="tn-notif-empty">You&apos;re all caught up.</div>
            ) : (
              items.map((n) => (
                <div key={n.id} className="tn-notif-item">
                  <div className="tn-notif-body">
                    <div className="tn-notif-title">{TITLE[n.type] ?? n.type} — {n.siteName}</div>
                    {n.detail && <div className="tn-notif-detail">{n.detail}</div>}
                    <div className="tn-notif-when">{n.when}</div>
                  </div>
                  <div className="tn-notif-actions">
                    <button title="Mark read" onClick={() => void act(`/api/admin/notifications/${n.id}/read`, "POST")}>✓</button>
                    <button title="Delete" onClick={() => void act(`/api/admin/notifications/${n.id}`, "DELETE")}>✕</button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="tn-notif-foot">
            <Link href="/admin/notifications" className="tn-notif-link" onClick={onToggle}>View all notifications →</Link>
            {unread > items.length && <span className="tn-notif-more">and {unread - items.length} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add panel styles.** In `src/app/(app)/globals.css`, add styles for `.tn-notif-panel` and its children, reusing the existing `.tn-menu` dropdown look (position/background/border/shadow) but wider (~320px), with `.tn-notif-list` scrollable (`max-height: 24rem; overflow-y:auto`), `.tn-notif-item` a flex row (body + actions), `.tn-notif-head`/`.tn-notif-foot` with a subtle divider, and `.tn-notif-actions button` as small icon buttons. Match the file's existing token variables (colors/spacing) — don't hardcode a new palette.

- [ ] **Step 3: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add "src/app/(app)/_shell/notification-bell.tsx" "src/app/(app)/globals.css"
git commit -m "feat(notifications): NotificationBell dropdown component"
```

---

### Task 4: Wire the bell into the topnav

**Files:**
- Modify: `src/app/(app)/_shell/topnav.tsx`

**Interfaces:**
- Consumes: `NotificationBell` (Task 3). Uses the topnav's existing `open` state.

- [ ] **Step 1: Import the component.** At the top of `topnav.tsx`, add:

```ts
import { NotificationBell } from "./notification-bell";
```

- [ ] **Step 2: Replace the bell Link block.** Swap the current `model.showNotifications && (<Link …>bell</Link>)` block (around lines 92-97) for:

```tsx
        {model.showNotifications && (
          <NotificationBell
            badge={model.notificationsBadge}
            open={open === "notifications"}
            onToggle={() => setOpen((v) => (v === "notifications" ? null : "notifications"))}
          />
        )}
```

(The `open` state and `setOpen` already exist and drive the account menu the same way; `"notifications"` is a new value for the same single-open-dropdown state, so opening the bell closes the account menu and vice-versa.)

- [ ] **Step 3: Typecheck + full test suite.**

Run: `pnpm build && pnpm test`
Expected: PASS (no new unit tests; existing suite green).

- [ ] **Step 4: Commit.**

```bash
git add "src/app/(app)/_shell/topnav.tsx"
git commit -m "feat(notifications): open the bell dropdown from the topnav"
```

---

## Deploy (SEPARATE — needs explicit user approval, do not run as part of implementation)

- Manager-only; no schema/`db push`, no dataplane/connector.
- Tag the release; bump prod compose manager (+ migrate for tag discipline).
- Smoke: `/login` 200; the bell opens a panel (no navigation); mark-read/delete/mark-all-read work; opening alone doesn't change the badge; "View all" navigates.
- English user-facing release note.

## Self-Review

- **Spec coverage:** list endpoint (T1), delete endpoint (T2), dropdown component with per-item mark-read/delete + mark-all + view-all + no-auto-read + badge refresh (T3), topnav wiring (T4). All spec sections mapped.
- **Placeholder scan:** none — endpoints and component are given in full; the CSS step describes concrete classes/behaviour and says to reuse existing tokens rather than inventing a palette (the exact rules match the file's existing `.tn-menu` styling, which must be read in-place).
- **Consistency:** endpoints all `read_console`-gated like the existing routes; `NotificationBell` props (`badge/open/onToggle`) match the T4 call site; `"notifications"` reuses the existing single-open `open` state; the friendly `TITLE` map matches the model's `type` values (`site_down`/`site_recovered`).
