import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { RecoverySetup } from "./recovery-setup";
import { RemoveRecoveryButton } from "./remove-recovery-button";

export const dynamic = "force-dynamic";

export default async function RecoveryPage() {
  const user = await requireUser();

  const totp = await db.totpSecret.findUnique({
    where: { userId: user.id },
    select: { confirmedAt: true },
  });
  const active = Boolean(totp?.confirmedAt);

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/settings/passkeys">Passkey&apos;lerim</Link>
        <Link href="/settings/recovery" className="active">
          Kurtarma
        </Link>
      </nav>

      <h1>Kurtarma kurulumu</h1>
      <p>
        Tüm passkey&apos;lerinizi kaybederseniz hesabınıza erişimi geri
        kazanmak için bir doğrulama uygulaması (Google Authenticator, 1Password
        vb.) ile kurtarma kodu ekleyin.
      </p>

      {active ? (
        <div>
          <p className="badge">Kurtarma etkin</p>
          <RemoveRecoveryButton />
        </div>
      ) : (
        <RecoverySetup accountName={user.email} />
      )}
    </main>
  );
}
