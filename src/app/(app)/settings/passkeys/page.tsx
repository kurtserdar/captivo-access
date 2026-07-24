import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { AddPasskeyButton } from "./add-passkey-button";
import { DeletePasskeyButton } from "./delete-passkey-button";

// Passkey listesi her istekte taze okunmalı (ekleme/silme sonrası tam sayfa yenileme).
export const dynamic = "force-dynamic";

export default async function PasskeysPage() {
  const user = await requireUser();

  // Yalnızca serileştirilebilir alanlar seçilir — counter (BigInt) ve
  // publicKey (Bytes) burada gerekmiyor ve Server→Client bileşen sınırında
  // BigInt zaten serileştirilemez.
  const passkeys = await db.passkey.findMany({
    where: { userId: user.id },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "asc" },
  });

  const canDelete = passkeys.length > 1;

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/settings/passkeys" className="active">
          Passkey&apos;lerim
        </Link>
        <Link href="/settings/recovery">Kurtarma</Link>
      </nav>

      <h1>Passkey&apos;lerim</h1>
      <p>
        Bu hesaba bağlı passkey&apos;leri yönetin. Hesabınızın kilitlenmemesi
        için en az bir passkey kalmalıdır.
      </p>

      <AddPasskeyButton />

      <table>
        <thead>
          <tr>
            <th>Etiket</th>
            <th>Oluşturma</th>
            <th>Son kullanım</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {passkeys.map((pk) => (
            <tr key={pk.id}>
              <td>{pk.label}</td>
              <td>{pk.createdAt.toLocaleString("tr-TR")}</td>
              <td>{pk.lastUsedAt ? pk.lastUsedAt.toLocaleString("tr-TR") : "—"}</td>
              <td>
                <DeletePasskeyButton id={pk.id} disabled={!canDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
