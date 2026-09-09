"use client";

import Link from "next/link";
import { useState } from "react";
import { LocalTime } from "@/app/(app)/_shell/local-time";

type Row = { tenantId: string; slug: string; tenantName: string; id: string; email: string; name: string; role: string; status: string; createdAt: string };

export function UserSearch() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/users?email=${encodeURIComponent(q.trim())}`);
      setRows(res.ok ? ((await res.json()) as { users: Row[] }).users : []);
    } finally { setBusy(false); }
  }
  return (
    <div>
      <form className="row-actions" onSubmit={search} style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 360 }} placeholder="email or part of it" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy || q.trim().length < 2}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {rows === null ? null : rows.length === 0 ? <div className="empty">No user matches.</div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>User</th><th>Tenant</th><th>Role</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.tenantId}:${r.id}`}>
                  <td>{r.name}<div className="cell-sub">{r.email}</div></td>
                  <td><Link href={`/platform/tenants/${r.tenantId}`} className="link-button">{r.tenantName}</Link><div className="cell-sub">{r.slug}</div></td>
                  <td className="cell-sub">{r.role}</td>
                  <td><span className={`pill ${r.status === "ACTIVE" ? "ok" : "neutral"}`}>{r.status}</span></td>
                  <td className="cell-sub"><LocalTime iso={r.createdAt} mode="date" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
