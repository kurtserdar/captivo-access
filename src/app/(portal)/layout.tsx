import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { LogoutButton } from "../(app)/logout-button";
import { PortalNav } from "./_nav/portal-nav";

export const dynamic = "force-dynamic";

// Light, self-contained shell for connect-only (vendor) users. No admin sidebar.
// Theme-independent: explicit light palette, Public Sans.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const initials = (user.name ?? user.email ?? "?").trim().slice(0, 2).toUpperCase();
  return (
    <div className="vp-root">
      <div className="vp-brandline" />
      <header className="vp-nav">
        <div className="vp-brand">
          <div className="vp-logo">C</div>
          <span className="vp-word">Captivo <span className="vp-word-sub">ACCESS</span></span>
        </div>
        <nav className="vp-navlinks">
          <PortalNav />
        </nav>
        <div className="vp-navright">
          <div className="vp-avatar">{initials}</div>
          <LogoutButton />
        </div>
      </header>
      <div className="vp-body">{children}</div>
    </div>
  );
}
