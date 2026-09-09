import { notFound } from "next/navigation";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { resolvedDisplayTimezone } from "@/lib/settings/timezone";
import { platformAlerts } from "@/lib/platform/overview";
import { TimezoneProvider } from "@/app/(app)/_shell/timezone-context";
import { PlatformNav } from "./_shell/platform-nav";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!multiTenantEnabled()) notFound();
  // Same timezone resolution as the tenant consoles: the operator's own override,
  // else the platform tenant's display timezone, else the browser.
  const { user, tz, alerts } = await withRequestTenant(async () => {
    const user = await requirePlatformAdmin();
    const [tz, alerts] = await Promise.all([resolvedDisplayTimezone(user.id), platformAlerts().catch(() => [])]);
    return { user, tz, alerts: alerts.length };
  });
  return (
    <TimezoneProvider tz={tz}>
      <div className="app">
        <PlatformNav userName={user.name} userEmail={user.email} alerts={alerts} />
        <main className="content">{children}</main>
      </div>
    </TimezoneProvider>
  );
}
