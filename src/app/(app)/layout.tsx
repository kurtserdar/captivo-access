import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { can, ROLE_LABELS } from "@/lib/auth/roles";
import { countPendingGrants } from "@/lib/access/grants";
import { countUnreadNotifications } from "@/lib/notifications";
import { getSearchRecords } from "@/lib/search";
import { UpdateBanner } from "@/app/(app)/_shell/update-banner";
import { getUpdateCheckConfig } from "@/lib/updates/update-check-config";
import { managerVersion } from "@/lib/version";
import { isUpdateAvailable } from "@/lib/updates/semver";
import { LogoutButton } from "./logout-button";
import { NavLink } from "./nav-link";
import { Topbar } from "./_shell/topbar";
import { BrandMark } from "@/components/brand";
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
  UpdatesIcon,
  RecordingsIcon,
} from "@/components/icons";

// requireUser() must be read fresh from the DB on every request (session/role changes reflect immediately).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const showGrants = can(user.role, "approve_grants");
  const showRead = can(user.role, "read_console");
  const showConfig = can(user.role, "configure");
  const pendingCount = showGrants ? await countPendingGrants() : 0;
  const unreadNotifications = showRead ? await countUnreadNotifications() : 0;
  const searchRecords = showRead ? await getSearchRecords() : [];
  const mgr = managerVersion();
  const upd = showConfig ? await getUpdateCheckConfig() : null;
  const updateEnabled = upd?.enabled ?? false;
  const bannerLatest = upd && isUpdateAvailable(upd.latestVersion, mgr) ? upd.latestVersion : null;
  const DAY_MS = 24 * 60 * 60 * 1000;
  // eslint-disable-next-line react-hooks/purity
  const staleCheck = !!upd?.enabled && (upd.lastCheckedAt == null || Date.now() - upd.lastCheckedAt.getTime() > DAY_MS);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <BrandMark size={22} />
          <span className="wordmark"><b>Captivo</b> <span className="wm-sub">Access</span></span>
        </Link>
        <span className="nav-group">Access</span>
        {showRead && (
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
        {showRead && (
          <>
            <span className="nav-group">Monitoring</span>
            <NavLink href="/admin/notifications">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              Notifications
              {unreadNotifications > 0 && <span className="nav-badge">{unreadNotifications}</span>}
            </NavLink>
            <NavLink href="/admin/audit">
              <AuditIcon />
              Audit log
            </NavLink>
          </>
        )}
        {showConfig && (
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
            <NavLink href="/admin/recordings">
              <RecordingsIcon />
              Recordings
            </NavLink>
            <NavLink href="/admin/email">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>
              Email
            </NavLink>
            <NavLink href="/admin/sso">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 18v3h3l11-11-3-3L2 18z" opacity="0"/><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5 21 2"/><path d="M16 7l3 3"/></svg>
              Single sign-on
            </NavLink>
            <NavLink href="/admin/domain">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              Custom domain
            </NavLink>
            <NavLink href="/admin/updates">
              <UpdatesIcon />
              Updates
            </NavLink>
            <span className="nav-group">People</span>
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
          </>
        )}
        <span className="nav-group">Account</span>
        <NavLink href="/settings/passkeys">
          <SettingsIcon />
          Settings
        </NavLink>
        <div className="nav-foot">
          <span className="nav-user">
            {user.name} · {ROLE_LABELS[user.role] ?? user.role}
          </span>
          <LogoutButton />
        </div>
      </aside>
      <div className="main-col">
        {showConfig && (
          <UpdateBanner
            enabled={updateEnabled}
            staleCheck={staleCheck}
            currentVersion={mgr}
            latestVersion={bannerLatest}
            latestUrl={upd?.latestUrl ?? null}
          />
        )}
        <Topbar records={searchRecords} role={user.role} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
