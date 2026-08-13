"use client";
import Link from "next/link";
import { useState } from "react";
import { isConnectorOutdated } from "@/lib/updates/semver";
import { textMatch } from "@/lib/table/filter";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { ConnectorName } from "./connector-name";
import { DeleteConnectorButton } from "./delete-connector-button";
import { RepairConnectorButton } from "./repair-connector-button";
import { RevokeConnectorButton } from "./revoke-connector-button";
import { UpdateConnectorButton } from "./update-connector-button";

const STATUS_LABEL: Record<string, string> = { PENDING: "Pending", ONLINE: "Online", OFFLINE: "Offline", REVOKED: "Revoked" };
const STATUS_PILL: Record<string, string> = { PENDING: "warn", ONLINE: "ok", OFFLINE: "neutral", REVOKED: "danger" };

export interface ConnectorRow {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  version: string | null;
  sitesCount: number;
}

export function ConnectorsTable({
  rows,
  mgr,
  updateCommand,
  managerUrlIsLocal,
}: {
  rows: ConnectorRow[];
  mgr: string;
  updateCommand: string;
  managerUrlIsLocal: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const statuses = [...new Set(rows.map((r) => r.status))];
  const filtered = rows.filter(
    (r) => (status === "" || r.status === status) && textMatch([r.name, STATUS_LABEL[r.status] ?? r.status, r.version], q),
  );

  return (
    <>
      <div className="filter-bar" style={{ marginBottom: ".8rem" }}>
        <div className="field field-search">
          <label className="field-label" htmlFor="conn-q">Search</label>
          <input id="conn-q" className="input" placeholder="name, status, version…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="conn-status">Status</label>
          <select id="conn-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty">No matching connectors.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Status</th><th>Last seen</th><th>Version</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><ConnectorName id={c.id} name={c.name} /></td>
                  <td><span className={`pill ${STATUS_PILL[c.status] ?? "neutral"}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
                  <td className="cell-sub">{c.lastSeenAt ? <LocalTime iso={c.lastSeenAt} /> : "Never"}</td>
                  <td className="cell-sub">
                    {c.version ?? "—"}
                    {isConnectorOutdated(c.version, mgr) && <span className="pill warn" style={{ marginLeft: ".4rem" }}>Outdated</span>}
                  </td>
                  <td>
                    {c.status !== "REVOKED" ? (
                      <div className="row-actions">
                        <Link href={`/admin/connectors/${c.id}`} className="btn sm">Details</Link>
                        {isConnectorOutdated(c.version, mgr) && <UpdateConnectorButton command={updateCommand} managerUrlIsLocal={managerUrlIsLocal} />}
                        <RepairConnectorButton id={c.id} />
                        <RevokeConnectorButton id={c.id} />
                      </div>
                    ) : c.sitesCount === 0 ? (
                      <DeleteConnectorButton id={c.id} name={c.name} />
                    ) : (
                      <span className="cell-sub">Revoked · remove its {c.sitesCount} resource{c.sitesCount === 1 ? "" : "s"} under Resources to delete this connector</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
