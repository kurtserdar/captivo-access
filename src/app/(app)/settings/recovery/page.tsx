import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { RecoverySetup } from "./recovery-setup";
import { RemoveRecoveryButton } from "./remove-recovery-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recovery" };

export default async function RecoveryPage() {
  const user = await requireUser();

  const totp = await db.totpSecret.findUnique({
    where: { userId: user.id },
    select: { confirmedAt: true },
  });
  const active = Boolean(totp?.confirmedAt);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Recovery setup</h1>
          <p>
            Add a recovery code using an authenticator app (Google Authenticator,
            1Password, etc.) so you can regain access to your account if you lose
            all your passkeys.
          </p>
          <p className="cell-sub">
            <Link href="/settings/passkeys" className="link-button">
              My passkeys
            </Link>{" "}
            · Recovery
          </p>
        </div>
      </div>

      <div className="card">
        {active ? (
          <>
            <p>
              <span className="pill ok">Recovery enabled</span>
            </p>
            <RemoveRecoveryButton />
          </>
        ) : (
          <RecoverySetup accountName={user.email} />
        )}
      </div>
    </main>
  );
}
