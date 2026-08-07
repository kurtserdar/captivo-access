import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { AddPasskeyButton } from "./add-passkey-button";
import { DeletePasskeyButton } from "./delete-passkey-button";

// The passkey list must be read fresh on every request (full page reload after add/delete).
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function PasskeysPage() {
  const user = await requireUser();

  // Only serializable fields are selected — counter (BigInt) and
  // publicKey (Bytes) aren't needed here, and BigInt can't be serialized
  // across the Server→Client component boundary anyway.
  const passkeys = await db.passkey.findMany({
    where: { userId: user.id },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "asc" },
  });

  const canDelete = passkeys.length > 1;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>My passkeys</h1>
          <p>
            Manage the passkeys linked to this account. At least one passkey must
            remain so your account doesn&apos;t get locked out.
          </p>
          <p className="cell-sub">
            My passkeys · <Link href="/settings/recovery" className="link-button">Recovery</Link>
          </p>
        </div>
        <AddPasskeyButton />
      </div>

      {passkeys.length === 0 ? (
        <div className="empty">No passkeys yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Created</th>
                <th>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {passkeys.map((pk) => (
                <tr key={pk.id}>
                  <td>{pk.label}</td>
                  <td className="cell-sub"><LocalTime iso={pk.createdAt.toISOString()} /></td>
                  <td className="cell-sub">
                    {pk.lastUsedAt ? <LocalTime iso={pk.lastUsedAt.toISOString()} /> : "—"}
                  </td>
                  <td>
                    <DeletePasskeyButton id={pk.id} disabled={!canDelete} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
