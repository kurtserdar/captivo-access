import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ConnectorForm } from "./connector-form";
import { RevokeConnectorButton } from "./revoke-connector-button";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  ONLINE: "Online",
  OFFLINE: "Offline",
  REVOKED: "Revoked",
};

export default async function AdminConnectorsPage() {
  await requireAdmin();

  const connectors = await db.connector.findMany({
    select: { id: true, name: true, status: true, lastSeenAt: true, version: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/sessions">Sessions</Link>
        <Link href="/admin/invites">Invites</Link>
        <Link href="/admin/connectors" className="active">
          Connectors
        </Link>
        <Link href="/admin/sites">Sites</Link>
      </nav>

      <h1>Connectors</h1>
      <p>
        A connector is a small agent you run inside a customer&apos;s network. Pair one here, then add sites
        to expose specific internal upstreams through it.
      </p>
      <ConnectorForm />

      <h2>Registered connectors</h2>
      {connectors.length === 0 ? (
        <p>No connectors yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Last seen</th>
              <th>Version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                <td>{c.lastSeenAt ? c.lastSeenAt.toLocaleString("en-US") : "Never"}</td>
                <td>{c.version ?? "—"}</td>
                <td>{c.status === "REVOKED" ? <span>Revoked</span> : <RevokeConnectorButton id={c.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
