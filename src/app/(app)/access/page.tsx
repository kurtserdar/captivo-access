import { requireUser } from "@/lib/current-user";
import { listUserGrants } from "@/lib/access/grants";
import { classifyGrant } from "@/lib/access/evaluate";
import { recordingEnabled } from "@/lib/recording/enabled";
import { RequestAccessButton } from "./request-access-button";
import { AccessView, type AccessRow } from "./access-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "My access" };

export default async function AccessPage() {
  const user = await requireUser();
  const grants = await listUserGrants(user.id);
  const now = new Date();
  const recEnabled = recordingEnabled();

  const rows: AccessRow[] = [];
  for (const g of grants) {
    const reason = classifyGrant(g, now);
    let status: AccessRow["status"] | null = null;
    if (reason === "allow") status = "active";
    else if (reason === "not_yet") status = "upcoming";
    else if (reason === "off_schedule") status = "off_hours";
    else if (reason === "pending_approval") status = "pending";
    else if (reason === "denied") status = "denied";
    if (!status) continue; // expired/revoked grants are not shown here.
    rows.push({
      id: g.id,
      siteId: g.site.id,
      siteName: g.site.name,
      hostname: g.site.hostname,
      hasLogo: g.site.logoType != null,
      startsAtISO: g.startsAt ? g.startsAt.toISOString() : null,
      endsAtISO: g.endsAt ? g.endsAt.toISOString() : null,
      schedule: g.schedule,
      status,
      denyReason: g.denyReason ?? null,
      recorded: recEnabled && g.site.recordSessions,
    });
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>My access</h1>
          <p>Sites you have been granted access to, and when that access applies.</p>
        </div>
        <RequestAccessButton />
      </div>

      {rows.length === 0 ? (
        <div className="empty">You don&apos;t have any access right now.</div>
      ) : (
        <AccessView rows={rows} />
      )}
    </main>
  );
}
