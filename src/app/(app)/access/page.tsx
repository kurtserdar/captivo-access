import { requireUser } from "@/lib/current-user";
import { listUserGrants } from "@/lib/access/grants";
import { classifyGrant } from "@/lib/access/evaluate";
import { parseSchedule, formatSchedule } from "@/lib/access/schedule";
import { RequestAccessForm } from "./request-access-form";
import { WithdrawRequestButton } from "./withdraw-request-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "My access" };

function formatWindow(startsAt: Date | null, endsAt: Date | null): string {
  const start = startsAt ? startsAt.toLocaleString("en-US") : "Immediately";
  const end = endsAt ? endsAt.toLocaleString("en-US") : "Permanent";
  return `${start} → ${end}`;
}

type Grant = Awaited<ReturnType<typeof listUserGrants>>[number];

function GrantTable({ grants, badge, openable }: { grants: Grant[]; badge: React.ReactNode; openable?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Site</th>
            <th>Window</th>
            <th>Status</th>
            {openable && <th></th>}
          </tr>
        </thead>
        <tbody>
          {grants.map((g) => (
            <tr key={g.id}>
              <td>{g.site.name}</td>
              <td className="cell-sub">
                {formatWindow(g.startsAt, g.endsAt)}
                {(() => { const s = parseSchedule(g.schedule); return s ? <div>{formatSchedule(s)}</div> : null; })()}
              </td>
              <td>{badge}</td>
              {openable && (
                <td>
                  <a className="btn sm" href={`https://${g.site.hostname}`} target="_blank" rel="noopener noreferrer">
                    Open ↗
                  </a>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AccessPage() {
  const user = await requireUser();
  const grants = await listUserGrants(user.id);
  const now = new Date();

  const active: Grant[] = [];
  const upcoming: Grant[] = [];
  const offHours: Grant[] = [];
  const requests: { grant: Grant; reason: "pending_approval" | "denied" }[] = [];
  for (const g of grants) {
    const reason = classifyGrant(g, now);
    if (reason === "allow") active.push(g);
    else if (reason === "not_yet") upcoming.push(g);
    else if (reason === "off_schedule") offHours.push(g);
    else if (reason === "pending_approval") requests.push({ grant: g, reason });
    else if (reason === "denied") requests.push({ grant: g, reason });
    // expired and revoked grants are not shown here.
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>My access</h1>
          <p>Sites you have been granted access to, and when that access applies.</p>
        </div>
      </div>

      <RequestAccessForm />

      {active.length === 0 && upcoming.length === 0 && offHours.length === 0 ? (
        <div className="empty">You don&apos;t have any active access right now.</div>
      ) : active.length === 0 && upcoming.length === 0 ? null : (
        <>
          <h2>Active</h2>
          {active.length === 0 ? (
            <p className="cell-sub">No active grants.</p>
          ) : (
            <GrantTable grants={active} badge={<span className="pill ok">Active</span>} openable />
          )}

          <h2>Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="cell-sub">No upcoming grants.</p>
          ) : (
            <GrantTable grants={upcoming} badge={<span className="pill warn">Upcoming</span>} />
          )}
        </>
      )}

      {offHours.length > 0 && (
        <>
          <h2>Outside current hours</h2>
          <GrantTable grants={offHours} badge={<span className="pill warn">Outside hours</span>} />
        </>
      )}

      {requests.length > 0 && (
        <>
          <h2>Requests</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>App</th><th>Window</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {requests.map(({ grant, reason }) => (
                  <tr key={grant.id}>
                    <td>{grant.site.name}</td>
                    <td className="cell-sub">{formatWindow(grant.startsAt, grant.endsAt)}</td>
                    <td>
                      {reason === "pending_approval"
                        ? <span className="pill warn">Pending approval</span>
                        : <span className="pill danger">Denied</span>}
                      {reason === "denied" && grant.denyReason && <div className="cell-sub">{grant.denyReason}</div>}
                    </td>
                    <td>
                      {reason === "pending_approval" && <WithdrawRequestButton id={grant.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
