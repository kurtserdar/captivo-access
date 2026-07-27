import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { listGrants } from "@/lib/access/grants";
import { classifyGrant, type DecisionReason } from "@/lib/access/evaluate";
import { GrantForm } from "./grant-form";
import { RevokeGrantButton } from "./revoke-grant-button";
import { TestAccessWidget } from "./test-access-widget";

export const dynamic = "force-dynamic";

// classifyGrant only ever returns these five reasons for a single grant window;
// user_disabled/no_grant are evaluateAccess-level (multi-grant + user status),
// never produced here, but included so the Record stays exhaustive over the type.
const REASON_LABEL: Record<DecisionReason, string> = {
  allow: "Active",
  not_yet: "Upcoming",
  expired: "Expired",
  revoked: "Revoked",
  pending_approval: "Awaiting approval",
  user_disabled: "Active",
  no_grant: "Active",
};

export default async function AdminGrantsPage() {
  await requireAdmin();

  const [users, sites, grants] = await Promise.all([
    db.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "desc" }, { name: "asc" }], // VENDOR before ADMIN
    }),
    db.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listGrants(),
  ]);

  const now = new Date();

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/sessions">Sessions</Link>
        <Link href="/admin/invites">Invites</Link>
        <Link href="/admin/connectors">Connectors</Link>
        <Link href="/admin/sites">Sites</Link>
        <Link href="/admin/grants" className="active">
          Grants
        </Link>
      </nav>

      <h1>Access grants</h1>
      <p>Grant a user time-boxed access to a site. Leave the end date empty for permanent access.</p>

      {users.length === 0 || sites.length === 0 ? (
        <p>Add a user and a site before creating a grant.</p>
      ) : (
        <GrantForm users={users} sites={sites} />
      )}

      <h2>Grants</h2>
      {grants.length === 0 ? (
        <p>No grants yet.</p>
      ) : (
        <table>
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
              const status = REASON_LABEL[classifyGrant(g, now)];
              const start = g.startsAt ? g.startsAt.toLocaleString("en-US") : "Immediately";
              const end = g.endsAt ? g.endsAt.toLocaleString("en-US") : "Permanent";
              return (
                <tr key={g.id}>
                  <td>
                    {g.user.name} ({g.user.email})
                  </td>
                  <td>{g.site.name}</td>
                  <td>
                    {start} → {end}
                  </td>
                  <td>{g.note ?? "—"}</td>
                  <td>{status}</td>
                  <td>{status === "Revoked" ? <span>Revoked</span> : <RevokeGrantButton id={g.id} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {users.length > 0 && sites.length > 0 && <TestAccessWidget users={users} sites={sites} />}
    </main>
  );
}
