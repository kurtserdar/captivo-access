"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import type { SearchRecord } from "@/lib/search";
import type { NavModel, NavGroup } from "@/lib/nav/model";
import { BrandMark } from "@/components/brand";
import { NavIcon } from "./nav-icons";
import { CommandPalette } from "./command-palette";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LogoutButton } from "../logout-button";
import { LivePill } from "./live-pill";

export function TopNav({ model, records, role, userName, roleLabel, showLive }: {
  model: NavModel; records: SearchRecord[]; role: Role; userName: string; roleLabel: string; showLive: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null); // open dropdown label | "account" | null
  const [drawer, setDrawer] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const isActive = (href: string) => href === "/" ? pathname === "/" : (pathname === href || pathname.startsWith(`${href}/`));
  const groupActive = (g: NavGroup) => g.columns.some((c) => c.items.some((it) => isActive(it.href)));

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
        <span className="brand-word">Captivo</span>
        <span className="brand-access">Access</span>
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
          </div>
        ))}
      </nav>

      <div className="tn-right">
        {showLive && <LivePill />}
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
        <div className="tn-dgroup">
          <div className="tn-dgroup-label">Account</div>
          <Link href="/access" className="tn-dlink sub">My access</Link>
          <Link href="/settings/passkeys" className="tn-dlink sub">Settings</Link>
        </div>
      </div>
    </header>
  );
}
