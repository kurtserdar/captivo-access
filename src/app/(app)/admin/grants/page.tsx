import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { listGrants, listPendingGrants } from "@/lib/access/grants";
import { classifyGrant, type DecisionReason } from "@/lib/access/evaluate";
import { GrantForm } from "./grant-form";
import { RevokeGrantButton } from "./revoke-grant-button";
import { TestAccessWidget } from "./test-access-widget";
import { DecisionButtons } from "./decision-buttons";

export const dynamic = "force-dynamic";

// classifyGrant only ever returns these five reasons for a single grant window;
// user_disabled/no_grant are evaluateAccess-level (multi-grant + user status),
// never produced here, but included so the Record stays exhaustive over the type.
const REASON_LABEL: Record<DecisionReason, string> = {
  allow: "Active",
  not_yet: "Upcoming",
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
  expired: "neutral",
  revoked: "danger",
  denied: "danger",
  pending_approval: "warn",
  user_disabled: "ok",
  no_grant: "ok",
};

export default async function AdminGrantsPage() {
  await requireAdmin();

  const [users, sites, grants, pending] = await Promise.all([
    db.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "desc" }, { name: "asc" }], // VENDOR before ADMIN
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
                      {(p.startsAt ? p.startsAt.toLocaleString("en-US") : "Immediately")} → {(p.endsAt ? p.endsAt.toLocaleString("en-US") : "Permanent")}
                    </td>
                    <td className="cell-sub">{p.note ?? "—"}</td>
                    <td><DecisionButtons grantId={p.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>New grant</h2>
        </div>
        {users.length === 0 || sites.length === 0 ? (
          <p>Add a user and a site before creating a grant.</p>
        ) : (
          <GrantForm users={users} sites={sites} />
        )}
      </div>

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
                const start = g.startsAt ? g.startsAt.toLocaleString("en-US") : "Immediately";
                const end = g.endsAt ? g.endsAt.toLocaleString("en-US") : "Permanent";
                return (
                  <tr key={g.id}>
                    <td>
                      {g.user.name} ({g.user.email})
                    </td>
                    <td>{g.site.name}</td>
                    <td className="cell-sub">
                      {start} → {end}
                    </td>
                    <td className="cell-sub">{g.note ?? "—"}</td>
                    <td>
                      <span className={`pill ${REASON_PILL[reason]}`}>{status}</span>
                    </td>
                    <td>
                      {status === "Revoked" ? (
                        <span className="cell-sub">Revoked</span>
                      ) : (
                        <RevokeGrantButton id={g.id} />
                      )}
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
