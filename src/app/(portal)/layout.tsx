import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { isConsoleUser } from "@/lib/auth/roles";
import { resolvedDisplayTimezone } from "@/lib/settings/timezone";
import { TimezoneProvider } from "@/app/(app)/_shell/timezone-context";
import { LogoutButton } from "../(app)/logout-button";
import { PortalNav } from "./_nav/portal-nav";
import { PortalMobileNav } from "./_nav/portal-mobile-nav";
import { BrandLockup } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { withRequestTenant } from "@/lib/tenant/request";

export const dynamic = "force-dynamic";

// Light, self-contained shell for connect-only (vendor) users. No admin sidebar.
// Theme-independent: explicit light palette, Public Sans.
async function PortalLayoutImpl({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tz = await resolvedDisplayTimezone(user.id);
  const initials = (user.name ?? user.email ?? "?").trim().slice(0, 2).toUpperCase();
  return (
    <TimezoneProvider tz={tz}>
    <div className="vp-root">
      <div className="vp-brandline" />
      <header className="vp-nav">
        <div className="vp-brand">
          <BrandLockup size={30} />
        </div>
        <nav className="vp-navlinks">
          <PortalNav />
          {isConsoleUser(user.role) && <Link href="/" className="vp-navlink vp-navlink-admin">Console →</Link>}
        </nav>
        <span className="vp-sep" aria-hidden="true">|</span>
        <div className="vp-navright">
          <ThemeSwitcher />
          <div className="vp-avatar">{initials}</div>
          <LogoutButton />
        </div>
        <PortalMobileNav isAdmin={isConsoleUser(user.role)} initials={initials} />
      </header>
      <div className="vp-body">{children}</div>
    </div>
    </TimezoneProvider>
  );
}

export default async function PortalLayout(...args: Parameters<typeof PortalLayoutImpl>) {
  return withRequestTenant(() => PortalLayoutImpl(...args));
}

