import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ToggleStatusButton } from "./toggle-status-button";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  VENDOR: "Vendor",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  DISABLED: "Disabled",
};

const STATUS_PILL: Record<string, string> = {
  ACTIVE: "ok",
  DISABLED: "danger",
};

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      company: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      _count: { select: { passkeys: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Manage all registered users and their access status.</p>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Role</th>
              <th>Status</th>
              <th>Passkeys</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="cell-sub">{u.email}</td>
                <td>
                  <div>{u.company ?? "—"}</div>
                  {u.phone && <div className="cell-sub">{u.phone}</div>}
                </td>
                <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                <td>
                  <span className={`pill ${STATUS_PILL[u.status] ?? "neutral"}`}>
                    {STATUS_LABEL[u.status] ?? u.status}
                  </span>
                </td>
                <td className="cell-sub">{u._count.passkeys}</td>
                <td>
                  {u.id === admin.id ? (
                    <span className="cell-sub" title="You can't disable yourself">
                      (this account)
                    </span>
                  ) : (
                    <ToggleStatusButton userId={u.id} status={u.status} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
