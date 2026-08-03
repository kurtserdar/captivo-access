import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { countPendingGrants } from "@/lib/access/grants";
import { countUnreadNotifications } from "@/lib/notifications";
import { LogoutButton } from "./logout-button";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  GrantsIcon,
  AccessIcon,
  ConnectorsIcon,
  SitesIcon,
  UsersIcon,
  InviteIcon,
  SessionsIcon,
  AuditIcon,
  SettingsIcon,
} from "@/components/icons";

// requireUser() must be read fresh from the DB on every request (session/role changes reflect immediately).
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  VENDOR: "Vendor",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const pendingCount = admin ? await countPendingGrants() : 0;
  const unreadNotifications = admin ? await countUnreadNotifications() : 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-glyph" />
          Captivo Access
        </Link>
        <span className="nav-group">Access</span>
        {admin && (
          <NavLink href="/admin/grants">
            <GrantsIcon />
            Grants
            {pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </NavLink>
        )}
        <NavLink href="/access">
          <AccessIcon />
          My access
        </NavLink>
        {admin && (
          <>
            <span className="nav-group">Infrastructure</span>
            <NavLink href="/admin/connectors">
              <ConnectorsIcon />
              Connectors
            </NavLink>
            <NavLink href="/admin/sites">
              <SitesIcon />
              Sites
            </NavLink>
            <NavLink href="/admin/notifications">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              Notifications
              {unreadNotifications > 0 && <span className="nav-badge">{unreadNotifications}</span>}
            </NavLink>
            <span className="nav-group">People &amp; audit</span>
            <NavLink href="/admin/users">
              <UsersIcon />
              Users
            </NavLink>
            <NavLink href="/admin/invites">
              <InviteIcon />
              Invites
            </NavLink>
            <NavLink href="/admin/sessions">
              <SessionsIcon />
              Sessions
            </NavLink>
            <NavLink href="/admin/audit">
              <AuditIcon />
              Audit log
            </NavLink>
          </>
        )}
        <span className="nav-group">Account</span>
        <NavLink href="/settings/passkeys">
          <SettingsIcon />
          Settings
        </NavLink>
        <div className="nav-foot">
          <span className="nav-user">
            {user.name} · {ROLE_LABEL[user.role] ?? user.role}
          </span>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
