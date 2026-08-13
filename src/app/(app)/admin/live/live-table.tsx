"use client";
import Link from "next/link";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { TerminateButton } from "@/app/(app)/_console/terminate-button";
import { RevokeAccessButton } from "@/app/(app)/_console/revoke-access-button";

export type LiveRow =
  | { kind: "gateway"; sessionId: string; siteName: string; userLabel: string; protocol: string; startedAt: string; viewerCount: number; controlled: boolean }
  | { kind: "web"; siteName: string; userLabel: string; host: string; startedAt: string; grantId: string | null };

export function LiveTable({ rows, canTerminate }: { rows: LiveRow[]; canTerminate: boolean }) {
  if (rows.length === 0) return <div className="empty">No active sessions.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Resource</th>
            <th>Type</th>
            <th>Started</th>
            <th>Watchers</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.kind === "gateway" ? (
              <tr key={r.sessionId}>
                <td>{r.userLabel}</td>
                <td>{r.siteName}</td>
                <td><span className="pill">{r.protocol.toUpperCase()}</span></td>
                <td className="cell-sub"><LocalTime iso={r.startedAt} /></td>
                <td className="cell-sub">{r.viewerCount}{r.controlled ? " · controlled" : ""}</td>
                <td className="row-actions">
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <Link href={`/live/${r.sessionId}`} className="btn sm">Watch</Link>
                    {canTerminate && <TerminateButton sessionId={r.sessionId} className="btn sm danger" />}
                  </span>
                </td>
              </tr>
            ) : (
              <tr key={`web:${r.userLabel}:${r.siteName}:${r.host}`}>
                <td>{r.userLabel}</td>
                <td>{r.siteName}</td>
                <td><span className="pill">WEB APP</span></td>
                <td className="cell-sub"><LocalTime iso={r.startedAt} /></td>
                <td className="cell-sub">—</td>
                <td className="row-actions">
                  {r.grantId ? (
                    <RevokeAccessButton grantId={r.grantId} label={r.userLabel} />
                  ) : (
                    <span className="cell-sub">No active grant</span>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
