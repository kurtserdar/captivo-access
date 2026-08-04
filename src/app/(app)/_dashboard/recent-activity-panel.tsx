import Link from "next/link";
import type { ActivityRow } from "@/lib/dashboard/stats";
import { timeAgo } from "@/lib/format";

export function RecentActivityPanel({ events }: { events: ActivityRow[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Recent activity</h2>
        <Link className="link-button" href="/admin/audit">Audit log</Link>
      </div>
      {events.length === 0 ? (
        <div className="empty">No access activity yet — allowed and denied requests will appear here.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Decision</th><th>User</th><th>Site</th><th>Path</th><th>When</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td><span className={`pill ${e.decision === "ALLOW" ? "ok" : "danger"}`}>{e.decision === "ALLOW" ? "Allowed" : "Denied"}</span></td>
                  <td className="cell-sub">{e.userEmail ?? "—"}</td>
                  <td className="cell-sub">{e.siteName ?? e.host}</td>
                  <td className="cell-sub" style={{ maxWidth: "16ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.path}</td>
                  <td className="cell-sub">{timeAgo(e.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
