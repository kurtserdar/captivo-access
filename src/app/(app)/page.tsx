import { requireUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Yönetici",
  VENDOR: "Tedarikçi",
};

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main>
      <h1>Hoş geldiniz, {user.name}</h1>
      <span className="badge">{ROLE_LABEL[user.role] ?? user.role}</span>
      <p>
        Erişim özellikleri (tedarikçi oturumları, onay akışları) sonraki
        sürümde eklenecek. Şimdilik hesabınızı{" "}
        <a href="/settings/passkeys">Ayarlar</a> altından yönetebilirsiniz.
      </p>
    </main>
  );
}
