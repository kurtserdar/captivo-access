import Link from "next/link";
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

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      _count: { select: { passkeys: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/admin/users" className="active">
          Users
        </Link>
        <Link href="/admin/sessions">Sessions</Link>
        <Link href="/admin/invites">Invites</Link>
      </nav>

      <h1>Users</h1>
      <p>Manage all registered users and their access status.</p>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
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
              <td>{u.email}</td>
              <td>{ROLE_LABEL[u.role] ?? u.role}</td>
              <td>{STATUS_LABEL[u.status] ?? u.status}</td>
              <td>{u._count.passkeys}</td>
              <td>
                {u.id === admin.id ? (
                  <span title="You can't disable yourself">(this account)</span>
                ) : (
                  <ToggleStatusButton userId={u.id} status={u.status} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
