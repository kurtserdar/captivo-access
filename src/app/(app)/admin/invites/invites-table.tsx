"use client";
import { useState } from "react";
import { textMatch } from "@/lib/table/filter";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { ResendInviteButton } from "./resend-invite-button";
import { CancelInviteButton } from "./cancel-invite-button";

const STATUS_PILL: Record<string, string> = { Used: "ok", Expired: "danger", Pending: "warn" };

export interface InviteRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  roleLabel: string;
  status: string;
  expiresAt: string;
}

export function InvitesTable({ rows }: { rows: InviteRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const statuses = [...new Set(rows.map((r) => r.status))];
  const filtered = rows.filter(
    (r) => (status === "" || r.status === status) && textMatch([r.name, r.email, r.company, r.phone, r.roleLabel, r.status], q),
  );

  return (
    <>
      <div className="filter-bar" style={{ marginBottom: ".8rem" }}>
        <div className="field field-search">
          <label className="field-label" htmlFor="inv-q">Search</label>
          <input id="inv-q" className="input" placeholder="name, email, company, role…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="inv-status">Status</label>
          <select id="inv-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty">No matching invites.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th>Status</th><th>Expires</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.name}</td>
                  <td className="cell-sub">{inv.email}</td>
                  <td>
                    <div>{inv.company ?? "—"}</div>
                    {inv.phone && <div className="cell-sub">{inv.phone}</div>}
                  </td>
                  <td>{inv.roleLabel}</td>
                  <td><span className={`pill ${STATUS_PILL[inv.status] ?? "neutral"}`}>{inv.status}</span></td>
                  <td className="cell-sub"><LocalTime iso={inv.expiresAt} /></td>
                  <td>
                    {inv.status !== "Used" && (
                      <div className="row-actions">
                        <ResendInviteButton id={inv.id} email={inv.email} />
                        <CancelInviteButton id={inv.id} email={inv.email} />
                      </div>
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
