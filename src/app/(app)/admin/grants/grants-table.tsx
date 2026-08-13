"use client";
import { useState } from "react";
import type { DecisionReason } from "@/lib/access/evaluate";
import { textMatch } from "@/lib/table/filter";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { RevokeGrantButton } from "./revoke-grant-button";
import { EditGrantButton } from "./edit-grant-button";

const REASON_LABEL: Record<DecisionReason, string> = {
  allow: "Active",
  not_yet: "Upcoming",
  off_schedule: "Outside hours",
  expired: "Expired",
  revoked: "Revoked",
  denied: "Denied",
  pending_approval: "Awaiting approval",
  user_disabled: "Active",
  no_grant: "Active",
};
const REASON_PILL: Record<DecisionReason, string> = {
  allow: "ok",
  not_yet: "warn",
  off_schedule: "warn",
  expired: "neutral",
  revoked: "danger",
  denied: "danger",
  pending_approval: "warn",
  user_disabled: "ok",
  no_grant: "ok",
};

export interface GrantRow {
  id: string;
  userName: string;
  userEmail: string;
  siteName: string;
  startsAt: string | null;
  endsAt: string | null;
  scheduleText: string | null;
  note: string | null;
  reason: DecisionReason;
  denyReason: string | null;
  active: boolean; // g.status === "ACTIVE"
}

export function GrantsTable({ rows, canApprove, canConfigure }: { rows: GrantRow[]; canApprove: boolean; canConfigure: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const reasons = [...new Set(rows.map((r) => r.reason))];
  const filtered = rows.filter(
    (r) =>
      (status === "" || r.reason === status) &&
      textMatch([r.userName, r.userEmail, r.siteName, REASON_LABEL[r.reason], r.note], q),
  );

  return (
    <>
      <div className="filter-bar" style={{ marginBottom: ".8rem" }}>
        <div className="field field-search">
          <label className="field-label" htmlFor="grant-q">Search</label>
          <input id="grant-q" className="input" placeholder="user, resource, status…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="grant-status">Status</label>
          <select id="grant-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {reasons.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty">No matching grants.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>User</th><th>Resource</th><th>Window</th><th>Note</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id}>
                  <td>{g.userName}<div className="cell-sub">{g.userEmail}</div></td>
                  <td>{g.siteName}</td>
                  <td className="cell-sub">
                    {g.startsAt ? <LocalTime iso={g.startsAt} /> : "Immediately"} → {g.endsAt ? <LocalTime iso={g.endsAt} /> : "Permanent"}
                    {g.scheduleText && <div>{g.scheduleText}</div>}
                  </td>
                  <td className="cell-sub">{g.note ?? "—"}</td>
                  <td>
                    <span className={`pill ${REASON_PILL[g.reason]}`}>{REASON_LABEL[g.reason]}</span>
                    {g.reason === "denied" && g.denyReason && <div className="cell-sub">{g.denyReason}</div>}
                  </td>
                  <td>
                    <div className="row-actions">
                      {canConfigure && g.active && <EditGrantButton id={g.id} endsAt={g.endsAt} note={g.note} />}
                      {!canApprove || g.reason === "revoked" || g.reason === "denied" ? (
                        <span className="cell-sub">{REASON_LABEL[g.reason]}</span>
                      ) : (
                        <RevokeGrantButton id={g.id} />
                      )}
                    </div>
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
