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
        <Link href="/settings/passkeys">My passkeys</Link>
        <Link href="/settings/recovery" className="active">
          Recovery
        </Link>
      </nav>

      <h1>Recovery setup</h1>
      <p>
        Add a recovery code using an authenticator app (Google Authenticator,
        1Password, etc.) so you can regain access to your account if you lose
        all your passkeys.
      </p>

      {active ? (
        <div>
          <p className="badge">Recovery enabled</p>
          <RemoveRecoveryButton />
        </div>
      ) : (
        <RecoverySetup accountName={user.email} />
      )}
    </main>
  );
}
