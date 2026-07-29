"use client";

import { useState } from "react";

export type AuditRowJSON = {
  id: string;
  timestamp: string;
  userId: string | null;
  userEmail: string | null;
  siteId: string | null;
  siteName: string | null;
  host: string;
  method: string;
  path: string;
  status: number;
  bytesOut: string;
  decision: "ALLOW" | "DENY";
  reason: string | null;
  clientIp: string | null;
};

type Filters = {
  userId: string;
  siteId: string;
  decision: "" | "ALLOW" | "DENY";
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = { userId: "", siteId: "", decision: "", from: "", to: "" };
const LIMIT = 50;

function toIso(datetimeLocal: string): string | undefined {
  if (!datetimeLocal) return undefined;
  const d = new Date(datetimeLocal);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function buildParams(filters: Filters, limit: number, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.siteId) params.set("siteId", filters.siteId);
  if (filters.decision) params.set("decision", filters.decision);
  const fromIso = toIso(filters.from);
  if (fromIso) params.set("from", fromIso);
  const toIsoValue = toIso(filters.to);
  if (toIsoValue) params.set("to", toIsoValue);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return params;
}

export function AuditTable({
  users,
  sites,
  initialRows,
  initialTotal,
}: {
  users: { id: string; name: string; email: string }[];
  sites: { id: string; name: string }[];
  initialRows: AuditRowJSON[];
  initialTotal: number;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AuditRowJSON[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextFilters: Filters, nextOffset: number) {
    setBusy(true);
    setError(null);
    try {
      const params = buildParams(nextFilters, LIMIT, nextOffset);
      const res = await fetch(`/api/admin/audit?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body?.rows)) {
        setError("Couldn't load audit events, please try again.");
        return;
      }
      setRows(body.rows);
      setTotal(typeof body.total === "number" ? body.total : 0);
      setFilters(nextFilters);
      setOffset(nextOffset);
    } catch {
      setError("Couldn't load audit events, please try again.");
    } finally {
      setBusy(false);
    }
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const nextFilters = { ...filters, [key]: value };
    load(nextFilters, 0);
  }

  const csvHref = `/api/admin/audit/export?${buildParams(filters, LIMIT, 0).toString()}`;
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  return (
    <section>
      <div className="filters">
        <label>
          User
          <select value={filters.userId} onChange={(e) => updateFilter("userId", e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </label>
        <label>
          Site
          <select value={filters.siteId} onChange={(e) => updateFilter("siteId", e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Decision
          <select
            value={filters.decision}
            onChange={(e) => updateFilter("decision", e.target.value as Filters["decision"])}
          >
            <option value="">All</option>
            <option value="ALLOW">Allow</option>
            <option value="DENY">Deny</option>
          </select>
        </label>
        <label>
          From
          <input type="datetime-local" value={filters.from} onChange={(e) => updateFilter("from", e.target.value)} />
        </label>
        <label>
          To
          <input type="datetime-local" value={filters.to} onChange={(e) => updateFilter("to", e.target.value)} />
        </label>
      </div>

      <div className="audit-toolbar">
        <span>
          {total} event{total === 1 ? "" : "s"}
        </span>
        <a href={csvHref}>Download CSV</a>
      </div>

      {error && <p role="alert">{error}</p>}

      {rows.length === 0 ? (
        <p>{busy ? "Loading…" : "No audit events match these filters."}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Site / Host</th>
              <th>Request</th>
              <th>Status</th>
              <th>Decision</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.timestamp).toLocaleString("en-US")}</td>
                <td>{r.userEmail ?? "—"}</td>
                <td>{r.siteName ?? r.host}</td>
                <td>
                  {r.method} {r.path}
                </td>
                <td>{r.status}</td>
                <td>
                  <span className={`result-badge ${r.decision === "ALLOW" ? "allow" : "deny"}`}>
                    {r.decision === "ALLOW" ? "Allow" : `Deny${r.reason ? ` — ${r.reason}` : ""}`}
                  </span>
                </td>
                <td>{r.clientIp ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="pagination">
        <button type="button" onClick={() => load(filters, Math.max(0, offset - LIMIT))} disabled={!hasPrev || busy}>
          Previous
        </button>
        <button type="button" onClick={() => load(filters, offset + LIMIT)} disabled={!hasNext || busy}>
          Next
        </button>
      </div>
    </section>
  );
}
