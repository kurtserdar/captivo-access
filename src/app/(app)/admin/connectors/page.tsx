import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ConnectorForm } from "./connector-form";
import { DeleteConnectorButton } from "./delete-connector-button";
import { RevokeConnectorButton } from "./revoke-connector-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connectors" };

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  ONLINE: "Online",
  OFFLINE: "Offline",
  REVOKED: "Revoked",
};

const STATUS_PILL: Record<string, string> = {
  PENDING: "warn",
  ONLINE: "ok",
  OFFLINE: "neutral",
  REVOKED: "danger",
};

export default async function AdminConnectorsPage() {
  await requireAdmin();

  const connectors = await db.connector.findMany({
    select: { id: true, name: true, status: true, lastSeenAt: true, version: true, _count: { select: { sites: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Connectors</h1>
          <p>
            A connector is a small agent you run inside a customer&apos;s network. Pair one here, then add
            sites to expose specific internal upstreams through it.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Add connector</h2>
        </div>
        <ConnectorForm />
      </div>

      <h2>Registered connectors</h2>
      {connectors.length === 0 ? (
        <div className="empty">No connectors yet — add one to reach an internal app.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
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
                  <td>
                    <span className={`pill ${STATUS_PILL[c.status] ?? "neutral"}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="cell-sub">{c.lastSeenAt ? c.lastSeenAt.toLocaleString("en-US") : "Never"}</td>
                  <td className="cell-sub">{c.version ?? "—"}</td>
                  <td>
                    {c.status !== "REVOKED" ? (
                      <RevokeConnectorButton id={c.id} />
                    ) : c._count.sites === 0 ? (
                      <DeleteConnectorButton id={c.id} name={c.name} />
                    ) : (
                      <span className="cell-sub">Revoked · remove its {c._count.sites} site{c._count.sites === 1 ? "" : "s"} under Sites to delete this connector</span>
                    )}
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
