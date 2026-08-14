"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LogoutButton } from "@/app/(app)/logout-button";

const LINKS = [
  { href: "/access", label: "My access" },
  { href: "/requests", label: "Requests" },
  { href: "/history", label: "History" },
];

// Phone-only header: a hamburger that opens a menu holding the nav links, the
// admin console link, the theme switcher, and logout. Shown via CSS below 640px;
// the desktop header (nav + avatar + logout) is hidden at the same breakpoint.
export function PortalMobileNav({ isAdmin, initials }: { isAdmin: boolean; initials: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);
  return (
    <div className="vp-mnav">
      <button type="button" className="vp-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <>
          <div className="vp-mscrim" onClick={close} />
          <div className="vp-mmenu" role="menu">
            <div className="vp-muser"><span className="vp-avatar">{initials}</span></div>
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link key={l.href} href={l.href} role="menuitem" className={active ? "vp-mlink active" : "vp-mlink"} onClick={close}>
                  {l.label}
                </Link>
              );
            })}
            {isAdmin && <a href="/" role="menuitem" className="vp-mlink vp-mlink-admin">Console →</a>}
            <div className="vp-mdiv" />
            <div className="vp-mrow"><span className="vp-mrow-label">Theme</span><ThemeSwitcher /></div>
            <div className="vp-mrow"><LogoutButton /></div>
          </div>
        </>
      )}
    </div>
  );
}
