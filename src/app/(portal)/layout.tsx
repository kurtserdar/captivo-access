import { requireUser } from "@/lib/current-user";
import { isConsoleUser } from "@/lib/auth/roles";
import { LogoutButton } from "../(app)/logout-button";
import { PortalNav } from "./_nav/portal-nav";
import { BrandLockup } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme-switcher";

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
          <BrandLockup size={26} />
        </div>
        <nav className="vp-navlinks">
          <PortalNav />
          {isConsoleUser(user.role) && <a href="/" className="vp-navlink vp-navlink-admin">Console →</a>}
        </nav>
        <span className="vp-sep" aria-hidden="true">|</span>
        <div className="vp-navright">
          <ThemeSwitcher />
          <div className="vp-avatar">{initials}</div>
          <LogoutButton />
        </div>
      </header>
      <div className="vp-body">{children}</div>
    </div>
  );
}
