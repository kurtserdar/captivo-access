import { adminActionLabel } from "@/lib/audit/admin-actions";
import { LocalTime } from "@/app/(app)/_shell/local-time";

export interface AdminAuditRowJSON {
  id: string;
  timestamp: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
}

export function AdminAuditTable({ rows }: { rows: AdminAuditRowJSON[] }) {
  if (rows.length === 0) return <div className="empty">No admin actions recorded yet.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="cell-sub"><LocalTime iso={r.timestamp} /></td>
              <td>{r.actorEmail ?? "—"}</td>
              <td><span className="pill">{adminActionLabel(r.action)}</span></td>
              <td className="cell-sub">{r.targetType ?? ""}{r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ""}</td>
              <td>{r.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
