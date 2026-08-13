import Link from "next/link";
import { ConnectorsIcon } from "@/components/icons";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { managerVersion } from "@/lib/version";
import { isConnectorOutdated } from "@/lib/updates/semver";
import { buildConnectorUpdateCommand } from "@/lib/connector/repair";
import { connectorTunnelUrl, isLocalManagerUrl } from "@/lib/url";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { AddConnectorButton } from "./add-connector-button";
import { ConnectorName } from "./connector-name";
import { DeleteConnectorButton } from "./delete-connector-button";
import { RepairConnectorButton } from "./repair-connector-button";
import { RevokeConnectorButton } from "./revoke-connector-button";
import { UpdateConnectorButton } from "./update-connector-button";
import { DeletePairingButton } from "./delete-pairing-button";

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

  // Fresh-install pairings created but not yet redeemed (the connector hasn't
  // connected). Re-pair pairings (connectorId set) belong to a connector already
  // in the list above, so they're excluded here.
  const pendingPairings = await db.connectorPairing.findMany({
    where: { usedAt: null, connectorId: null },
    select: { id: true, name: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
  const now = Date.now();

  const mgr = managerVersion();
  const managerUrl = process.env.MANAGER_PUBLIC_URL?.replace(/\/+$/, "") || "https://manager.<your-access-domain>";
  const managerUrlIsLocal = isLocalManagerUrl(managerUrl);

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="page-title-row"><span className="page-icon"><ConnectorsIcon /></span><h1>Connectors</h1></div>
          <p>
            A connector is a small agent you run inside a customer&apos;s network. Pair one here, then add
            resources to expose specific internal upstreams through it.
          </p>
        </div>
        <div className="row-actions">
          <AddConnectorButton />
        </div>
      </div>

      {connectors.length === 0 ? (
        <div className="empty">No connectors yet — use &quot;Add connector&quot; to reach an internal app.</div>
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
              {connectors.map((c) => {
                const updateCommand = buildConnectorUpdateCommand(managerUrl, connectorTunnelUrl());
                return (
                  <tr key={c.id}>
                    <td><ConnectorName id={c.id} name={c.name} /></td>
                    <td>
                      <span className={`pill ${STATUS_PILL[c.status] ?? "neutral"}`}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="cell-sub">{c.lastSeenAt ? <LocalTime iso={c.lastSeenAt.toISOString()} /> : "Never"}</td>
                    <td className="cell-sub">
                      {c.version ?? "—"}
                      {isConnectorOutdated(c.version, mgr) && (
                        <span className="pill warn" style={{ marginLeft: ".4rem" }}>Outdated</span>
                      )}
                    </td>
                    <td>
                      {c.status !== "REVOKED" ? (
                        <div className="row-actions">
                          <Link href={`/admin/connectors/${c.id}`} className="btn sm">Details</Link>
                          {isConnectorOutdated(c.version, mgr) && (
                            <UpdateConnectorButton command={updateCommand} managerUrlIsLocal={managerUrlIsLocal} />
                          )}
                          <RepairConnectorButton id={c.id} />
                          <RevokeConnectorButton id={c.id} />
                        </div>
                      ) : c._count.sites === 0 ? (
                        <DeleteConnectorButton id={c.id} name={c.name} />
                      ) : (
                        <span className="cell-sub">Revoked · remove its {c._count.sites} resource{c._count.sites === 1 ? "" : "s"} under Resources to delete this connector</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingPairings.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <div className="card-head"><div className="ch-title"><h2>Pending pairings</h2><span className="sub">Created but not yet connected — the connector appears above once it runs its install command.</span></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingPairings.map((p) => {
                  const expired = p.expiresAt.getTime() < now;
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="cell-sub"><LocalTime iso={p.createdAt.toISOString()} /></td>
                      <td className="cell-sub">
                        {expired ? (
                          <span className="pill warn">Expired</span>
                        ) : (
                          <LocalTime iso={p.expiresAt.toISOString()} />
                        )}
                      </td>
                      <td><DeletePairingButton id={p.id} name={p.name} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
