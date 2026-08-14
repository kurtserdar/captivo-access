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
import { resolvedDisplayTimezone } from "@/lib/settings/timezone";
import { TopNav } from "./_shell/topnav";
import { TimezoneProvider } from "./_shell/timezone-context";

// requireUser() must be read fresh from the DB on every request (session/role changes reflect immediately).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tz = await resolvedDisplayTimezone(user.id);
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
    <TimezoneProvider tz={tz}>
    <div className="app">
      <TopNav
        model={model}
        records={searchRecords}
        role={user.role}
        userName={user.name}
        roleLabel={ROLE_LABELS[user.role] ?? user.role}
        showLive={showRead}
      />
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
    </TimezoneProvider>
  );
}
