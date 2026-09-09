import Link from "next/link";
import { notFound } from "next/navigation";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { resolvedDisplayTimezone } from "@/lib/settings/timezone";
import { TimezoneProvider } from "@/app/(app)/_shell/timezone-context";
import { TimezoneLabel } from "@/app/(app)/_shell/effective-timezone";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!multiTenantEnabled()) notFound();
  // Same resolution as the tenant consoles: the operator's own override, else the
  // platform tenant's display timezone, else the browser.
  const tz = await withRequestTenant(async () => {
    const user = await requirePlatformAdmin();
    return resolvedDisplayTimezone(user.id);
  });
  return (
    <TimezoneProvider tz={tz}>
    <div className="app">
      <header className="topnav">
        <span className="tn-brand">
          <span className="brand-word">Captivo</span>
          <span className="brand-access">Platform</span>
        </span>
        <Link href="/platform/preferences" className="tn-menuitem" style={{ marginLeft: "auto" }} title="Display timezone"><TimezoneLabel /></Link>
      </header>
      <main className="content">{children}</main>
    </div>
    </TimezoneProvider>
  );
}
