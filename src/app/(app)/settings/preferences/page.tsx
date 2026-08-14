import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { TimezoneForm } from "./timezone-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const user = await requireUser();
  const u = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Preferences</h1>
          <p>Your personal display settings. These override the organization defaults for your account only.</p>
          <p className="cell-sub">
            <Link href="/settings/passkeys" className="link-button">My passkeys</Link> · <Link href="/settings/recovery" className="link-button">Recovery</Link> · Preferences
          </p>
        </div>
      </div>
      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Display timezone</h2>
        <p className="cell-sub" style={{ marginBottom: 12 }}>Dates and times you see are shown in this timezone. Leave on the organization default to follow the console-wide setting.</p>
        <TimezoneForm initial={u?.timezone ?? ""} />
      </section>
    </main>
  );
}
