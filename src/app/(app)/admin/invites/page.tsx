import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

function inviteStatus(inv: { usedAt: Date | null; expiresAt: Date }): string {
  if (inv.usedAt) return "Kullanıldı";
  if (inv.expiresAt < new Date()) return "Süresi doldu";
  return "Bekliyor";
}

export default async function AdminInvitesPage() {
  await requireAdmin();

  const invites = await db.invite.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <main>
      <h1>Davetler</h1>
      <p>Yeni bir tedarikçi veya yönetici davet edin. Davet bağlantısı yalnızca bir kez gösterilir.</p>
      <InviteForm />

      <h2>Gönderilen davetler</h2>
      {invites.length === 0 ? (
        <p>Henüz davet gönderilmedi.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Ad Soyad</th>
              <th>E-posta</th>
              <th>Rol</th>
              <th>Durum</th>
              <th>Son geçerlilik</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.name}</td>
                <td>{inv.email}</td>
                <td>{inv.role}</td>
                <td>{inviteStatus(inv)}</td>
                <td>{inv.expiresAt.toLocaleString("tr-TR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
