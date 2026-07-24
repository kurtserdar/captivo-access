import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ToggleStatusButton } from "./toggle-status-button";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Yönetici",
  VENDOR: "Tedarikçi",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktif",
  DISABLED: "Devre dışı",
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
          Kullanıcılar
        </Link>
        <Link href="/admin/sessions">Oturumlar</Link>
        <Link href="/admin/invites">Davetler</Link>
      </nav>

      <h1>Kullanıcılar</h1>
      <p>Kayıtlı tüm kullanıcıları ve erişim durumlarını yönetin.</p>

      <table>
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th>E-posta</th>
            <th>Rol</th>
            <th>Durum</th>
            <th>Passkey</th>
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
                  <span title="Kendinizi devre dışı bırakamazsınız">(bu hesap)</span>
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
