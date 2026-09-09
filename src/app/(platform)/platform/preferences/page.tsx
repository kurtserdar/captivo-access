import Link from "next/link";
import { db } from "@/lib/db";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { TimezoneForm } from "@/app/(app)/settings/preferences/timezone-form";
import { NameForm } from "@/app/(app)/settings/preferences/name-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preferences" };

// Platform-operator counterpart of /settings/preferences: the timezone the
// platform console shows dates in (stored on the operator's own User row).
export default async function PlatformPreferencesPage() {
  const current = await withRequestTenant(async () => {
    const user = await requirePlatformAdmin();
    const u = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true, name: true } });
    return { timezone: u?.timezone ?? "", name: u?.name ?? "" };
  });
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Preferences</h1>
          <p>Your personal display settings for the platform console.</p>
          <p className="cell-sub"><Link href="/platform" className="link-button">← Tenants</Link></p>
        </div>
      </div>
      <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Your name</h2>
      <div style={{ marginBottom: 24 }}><NameForm initial={current.name} /></div>
      <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Display timezone</h2>
      <p className="cell-sub" style={{ marginBottom: 12 }}>Dates and times you see here are shown in this timezone. Leave on the default to use your browser&apos;s timezone.</p>
      <TimezoneForm initial={current.timezone} />
    </section>
  );
}
