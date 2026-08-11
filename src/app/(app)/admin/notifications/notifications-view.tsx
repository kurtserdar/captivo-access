"use client";
import { useState } from "react";
import Link from "next/link";
import { MarkOneReadButton } from "./mark-one-read-button";

export type NotificationRow = {
  id: string;
  type: string;
  siteName: string;
  detail: string | null;
  when: string;
  read: boolean;
};

type StatusFilter = "all" | "site_down" | "site_recovered";

export function NotificationsView({ rows }: { rows: NotificationRow[] }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const shown = rows.filter((n) => {
    if (status !== "all" && n.type !== status) return false;
    if (unreadOnly && n.read) return false;
    if (query && !(`${n.siteName} ${n.detail ?? ""}`.toLowerCase().includes(query))) return false;
    return true;
  });

  return (
    <div>
      <div className="filters">
        <input
          className="input"
          type="search"
          placeholder="Search resource or detail…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 240 }}
        />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">All events</option>
          <option value="site_down">Down</option>
          <option value="site_recovered">Recovered</option>
        </select>
        <label className="form-check">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="empty">No matching notifications.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Resource</th>
                <th>Detail</th>
                <th>When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((n) => (
                <tr key={n.id} className={n.read ? undefined : "row-unread"}>
                  <td>
                    {n.type === "site_down" ? (
                      <span className="pill danger">Down</span>
                    ) : (
                      <span className="pill ok">Recovered</span>
                    )}
                  </td>
                  <td>
                    <Link href="/admin/sites">{n.siteName}</Link>
                  </td>
                  <td className="cell-sub">{n.detail ?? "—"}</td>
                  <td className="cell-sub">{n.when}</td>
                  <td>{!n.read && <MarkOneReadButton id={n.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
