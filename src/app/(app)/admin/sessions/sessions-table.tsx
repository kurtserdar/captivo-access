"use client";

import { useState } from "react";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";
import { RevokeSessionButton } from "./revoke-session-button";

export type SessionRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string; // ISO
  userName: string | null;
  userEmail: string | null;
};

export function SessionsTable({ sessions, currentSessionId }: { sessions: SessionRow[]; currentSessionId: string | null }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  // Selectable = every row except the caller's own current session.
  const selectableIds = sessions.filter((s) => s.id !== currentSessionId).map((s) => s.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function revokeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!(await confirm(`Revoke ${ids.length} selected session${ids.length === 1 ? "" : "s"}? Those users will be signed out immediately.`, { danger: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/sessions/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("Couldn't revoke the selected sessions, please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't revoke the selected sessions, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <div className="card-head">
        <button type="button" className="btn sm danger" onClick={revokeSelected} disabled={busy || selected.size === 0}>
          {busy ? "Revoking…" : `Revoke selected (${selected.size})`}
        </button>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all sessions" checked={allSelected} onChange={toggleAll} disabled={selectableIds.length === 0} />
              </th>
              <th>User</th>
              <th>IP</th>
              <th>Browser</th>
              <th>Last seen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const isCurrent = s.id === currentSessionId;
              return (
                <tr key={s.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select session for ${s.userEmail ?? "user"}`}
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      disabled={isCurrent}
                    />
                  </td>
                  <td>
                    {s.userName} ({s.userEmail})
                    {isCurrent && <span className="pill ok" style={{ marginLeft: ".4rem" }}>This device</span>}
                  </td>
                  <td className="cell-sub">{s.ip ?? "—"}</td>
                  <td className="cell-sub">{s.userAgent ?? "—"}</td>
                  <td className="cell-sub">{new Date(s.lastSeenAt).toLocaleString("en-US")}</td>
                  <td><RevokeSessionButton id={s.id} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
