"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand";

// Mobile-only: a hamburger + brand on the left of the top bar that slides the
// sidebar in as an off-canvas drawer, plus a scrim to dismiss it. Hidden on
// desktop (CSS). The drawer's open state is reflected onto <html data-nav-open>
// so the (server-rendered) sidebar can be driven purely by CSS. Closes on
// route change and on scrim tap.
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    document.documentElement.dataset.navOpen = open ? "1" : "";
    return () => {
      document.documentElement.dataset.navOpen = "";
    };
  }, [open]);

  return (
    <>
      <div className="mobile-nav-left">
        <button className="hamburger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <span className="mobile-brand">
          <BrandMark size={22} />
          <b>Captivo</b>
        </span>
      </div>
      {open && <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
    </>
  );
}
