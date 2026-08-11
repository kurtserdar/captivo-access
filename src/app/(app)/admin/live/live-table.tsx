"use client";
import Link from "next/link";
import { LocalTime } from "@/app/(app)/_shell/local-time";

export interface LiveRow {
  sessionId: string;
  siteName: string;
  userLabel: string;
  protocol: string;
  startedAt: string;
  viewerCount: number;
  controlled: boolean;
}

export function LiveTable({ rows }: { rows: LiveRow[] }) {
  if (rows.length === 0) return <div className="empty">No active remote-desktop sessions.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Site</th>
            <th>Type</th>
            <th>Started</th>
            <th>Watchers</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sessionId}>
              <td>{r.userLabel}</td>
              <td>{r.siteName}</td>
              <td><span className="pill">{r.protocol.toUpperCase()}</span></td>
              <td className="cell-sub"><LocalTime iso={r.startedAt} /></td>
              <td className="cell-sub">{r.viewerCount}{r.controlled ? " · controlled" : ""}</td>
              <td className="row-actions">
                <Link href={`/live/${r.sessionId}`} className="btn sm">Watch</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
