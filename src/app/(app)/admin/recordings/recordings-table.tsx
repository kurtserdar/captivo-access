"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { DeleteRecordingButton } from "./delete-recording-button";

export interface RecordingRowJSON {
  id: string;
  startedAt: string;
  lastEventAt: string;
  host: string;
  eventCount: number;
  bytes: number;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  siteId: string;
  siteName: string | null;
}

type Opt = { id: string; name: string | null; email?: string | null };

const PAGE = 50;

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function duration(a: string, b: string): string {
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RecordingsTable({
  users,
  sites,
  initialRows,
  initialTotal,
}: {
  users: Opt[];
  sites: Opt[];
  initialRows: RecordingRowJSON[];
  initialTotal: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (userId) sp.set("userId", userId);
      if (siteId) sp.set("siteId", siteId);
      if (from) sp.set("from", from);
      if (to) sp.set("to", to);
      sp.set("limit", String(PAGE));
      sp.set("offset", String(offset));
      const res = await fetch(`/api/admin/recordings?${sp.toString()}`);
      if (!res.ok) return;
      const body = (await res.json()) as { rows: RecordingRowJSON[]; total: number };
      setRows(body.rows);
      setTotal(body.total);
    } finally {
      setLoading(false);
    }
  }, [q, userId, siteId, from, to, offset]);

  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setOffset(0);
  }, [q, userId, siteId, from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE, total);

  return (
    <div>
      <div className="card">
        <div className="field">
          <label className="field-label" htmlFor="rec-filter-q">Search</label>
          <input
            id="rec-filter-q"
            type="search"
            className="input"
            placeholder="Search host…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rec-filter-site">Site</label>
          <select id="rec-filter-site" className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rec-filter-user">Vendor</label>
          <select id="rec-filter-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All vendors</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email ?? u.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rec-filter-from">From</label>
          <input id="rec-filter-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rec-filter-to">To</label>
          <input id="rec-filter-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">{loading ? "Loading…" : "No recordings match these filters."}</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th>User</th>
                <th>Site</th>
                <th>Duration</th>
                <th>Events</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-sub"><LocalTime iso={r.startedAt} /></td>
                  <td>
                    {r.userName ?? "—"}
                    {r.userEmail && <div className="cell-sub">{r.userEmail}</div>}
                  </td>
                  <td>{r.siteName ?? r.host}</td>
                  <td className="cell-sub">{duration(r.startedAt, r.lastEventAt)}</td>
                  <td className="cell-sub">{r.eventCount}</td>
                  <td className="cell-sub">{humanBytes(r.bytes)}</td>
                  <td className="row-actions">
                    <Link href={`/admin/recordings/${r.id}`} className="btn sm">Watch</Link>
                    <DeleteRecordingButton id={r.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-head">
        <span className="cell-sub">{loading ? "Loading…" : `${start}–${end} of ${total}`}</span>
        <div className="row-actions">
          <button type="button" className="btn sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Previous
          </button>
          <button type="button" className="btn sm" disabled={end >= total || loading} onClick={() => setOffset(offset + PAGE)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
