import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";

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

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    company: u.company,
    phone: u.phone,
    role: u.role,
    status: u.status,
    passkeys: u._count.passkeys,
    isSelf: u.id === admin.id,
  }));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Manage all registered users and their access status.</p>
        </div>
      </div>

      <UsersTable users={rows} initialQuery={q} />
    </main>
  );
}
