import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { RecoverySetup } from "./recovery-setup";
import { RemoveRecoveryButton } from "./remove-recovery-button";
import { withRequestTenant } from "@/lib/tenant/request";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recovery" };

async function RecoveryPageImpl() {
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
            · Recovery · <Link href="/settings/preferences" className="link-button">Preferences</Link>
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

export default async function RecoveryPage(...args: Parameters<typeof RecoveryPageImpl>) {
  return withRequestTenant(() => RecoveryPageImpl(...args));
}

