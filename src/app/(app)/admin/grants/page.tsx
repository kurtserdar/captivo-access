import { requireCapability } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { listGrants, listPendingGrants } from "@/lib/access/grants";
import { classifyGrant, type DecisionReason } from "@/lib/access/evaluate";
import { parseSchedule, formatSchedule } from "@/lib/access/schedule";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { AddGrantButton } from "./add-grant-button";
import { RevokeGrantButton } from "./revoke-grant-button";
import { EditGrantButton } from "./edit-grant-button";
import { TestAccessWidget } from "./test-access-widget";
import { DecisionButtons } from "./decision-buttons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grants" };

// classifyGrant only ever returns these six reasons for a single grant window;
// user_disabled/no_grant are evaluateAccess-level (multi-grant + user status),
// never produced here, but included so the Record stays exhaustive over the type.
const REASON_LABEL: Record<DecisionReason, string> = {
  allow: "Active",
  not_yet: "Upcoming",
  off_schedule: "Outside hours",
  expired: "Expired",
  revoked: "Revoked",
  denied: "Denied",
  pending_approval: "Awaiting approval",
  user_disabled: "Active",
  no_grant: "Active",
};

const REASON_PILL: Record<DecisionReason, string> = {
  allow: "ok",
  not_yet: "warn",
  off_schedule: "warn",
  expired: "neutral",
  revoked: "danger",
  denied: "danger",
  pending_approval: "warn",
  user_disabled: "ok",
  no_grant: "ok",
};

export default async function AdminGrantsPage() {
  const user = await requireCapability("read_console");
  const canApprove = can(user.role, "approve_grants");
  const canConfigure = can(user.role, "configure");

  const [users, sites, grants, pending] = await Promise.all([
    db.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "desc" }, { name: "asc" }], // connect-only roles (Vendor/Staff) first, Admin last
    }),
    db.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listGrants(),
    listPendingGrants(),
  ]);

  const now = new Date();

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Access grants</h1>
          <p>Grant a user time-boxed access to a site. Leave the end date empty for permanent access.</p>
        </div>
        {canApprove && users.length > 0 && sites.length > 0 && <AddGrantButton users={users} sites={sites} />}
      </div>

      {pending.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Pending requests</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>User</th><th>App</th><th>Requested window</th><th>Justification</th><th></th></tr></thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td>{p.user.name}<div className="cell-sub">{p.user.email}</div></td>
                    <td>{p.site.name}</td>
                    <td className="cell-sub">
                      {p.startsAt ? <LocalTime iso={p.startsAt.toISOString()} /> : "Immediately"} → {p.endsAt ? <LocalTime iso={p.endsAt.toISOString()} /> : "Permanent"}
                      {(() => { const s = parseSchedule(p.schedule); return s ? <div>{formatSchedule(s)}</div> : null; })()}
                    </td>
                    <td className="cell-sub">{p.note ?? "—"}</td>
                    <td>{canApprove ? <DecisionButtons grantId={p.id} /> : <span className="cell-sub">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2>Grants</h2>
      {grants.length === 0 ? (
        <div className="empty">No grants yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Site</th>
                <th>Window</th>
                <th>Note</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => {
                const reason = classifyGrant(g, now);
                const status = REASON_LABEL[reason];
                return (
                  <tr key={g.id}>
                    <td>
                      {g.user.name}
                      <div className="cell-sub">{g.user.email}</div>
                    </td>
                    <td>{g.site.name}</td>
                    <td className="cell-sub">
                      {g.startsAt ? <LocalTime iso={g.startsAt.toISOString()} /> : "Immediately"} → {g.endsAt ? <LocalTime iso={g.endsAt.toISOString()} /> : "Permanent"}
                      {(() => { const s = parseSchedule(g.schedule); return s ? <div>{formatSchedule(s)}</div> : null; })()}
                    </td>
                    <td className="cell-sub">{g.note ?? "—"}</td>
                    <td>
                      <span className={`pill ${REASON_PILL[reason]}`}>{status}</span>
                      {reason === "denied" && g.denyReason && <div className="cell-sub">{g.denyReason}</div>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {canConfigure && g.status === "ACTIVE" && (
                          <EditGrantButton id={g.id} endsAt={g.endsAt ? g.endsAt.toISOString() : null} note={g.note} />
                        )}
                        {/* A revoked or denied grant is terminal — no Revoke action. */}
                        {!canApprove || reason === "revoked" || reason === "denied" ? (
                          <span className="cell-sub">{status}</span>
                        ) : (
                          <RevokeGrantButton id={g.id} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {users.length > 0 && sites.length > 0 && <TestAccessWidget users={users} sites={sites} />}
    </main>
  );
}
