"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type AuditRowJSON = {
  id: string;
  timestamp: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  company: string | null;
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
  q: string;
  userId: string;
  siteId: string;
  decision: "" | "ALLOW" | "DENY";
  from: string;
  to: string;
};

const LIMIT = 50;

function toIso(datetimeLocal: string): string | undefined {
  if (!datetimeLocal) return undefined;
  const d = new Date(datetimeLocal);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function buildParams(filters: Filters, limit: number, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
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

function filtersFromParams(sp: URLSearchParams): Filters {
  const decision = sp.get("decision");
  return {
    q: sp.get("q") ?? "",
    userId: sp.get("userId") ?? "",
    siteId: sp.get("siteId") ?? "",
    decision: decision === "ALLOW" || decision === "DENY" ? decision : "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
  };
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(new URLSearchParams(searchParams.toString())));
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AuditRowJSON[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const url = params.toString();
      router.replace(url ? `${pathname}?${url}` : pathname, { scroll: false });
    } catch {
      setError("Couldn't load audit events, please try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const seeded = filtersFromParams(new URLSearchParams(searchParams.toString()));
    const hasAny = Object.values(seeded).some((v) => v !== "");
    if (hasAny) load(seeded, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const nextFilters = { ...filters, [key]: value };
    load(nextFilters, 0);
  }

  const csvHref = `/api/admin/audit/export?${buildParams(filters, LIMIT, 0).toString()}`;
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  return (
    <section>
      <div className="card">
        <div className="field">
          <label className="field-label" htmlFor="audit-filter-q">Search</label>
          <input
            id="audit-filter-q"
            type="search"
            className="input"
            placeholder="path, host, user, company…"
            value={filters.q}
            onChange={(e) => {
              const q = e.target.value;
              setFilters((prev) => ({ ...prev, q }));
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => load({ ...filters, q }, 0), 300);
            }}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="audit-filter-user">
            User
          </label>
          <select
            id="audit-filter-user"
            className="select"
            value={filters.userId}
            onChange={(e) => updateFilter("userId", e.target.value)}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="audit-filter-site">
            Site
          </label>
          <select
            id="audit-filter-site"
            className="select"
            value={filters.siteId}
            onChange={(e) => updateFilter("siteId", e.target.value)}
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="audit-filter-decision">
            Decision
          </label>
          <select
            id="audit-filter-decision"
            className="select"
            value={filters.decision}
            onChange={(e) => updateFilter("decision", e.target.value as Filters["decision"])}
          >
            <option value="">All</option>
            <option value="ALLOW">Allow</option>
            <option value="DENY">Deny</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="audit-filter-from">
            From
          </label>
          <input
            id="audit-filter-from"
            type="datetime-local"
            className="input"
            value={filters.from}
            onChange={(e) => updateFilter("from", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="audit-filter-to">
            To
          </label>
          <input
            id="audit-filter-to"
            type="datetime-local"
            className="input"
            value={filters.to}
            onChange={(e) => updateFilter("to", e.target.value)}
          />
        </div>
      </div>

      <div className="card-head">
        <span className="cell-sub">
          {total} event{total === 1 ? "" : "s"}
        </span>
        <a href={csvHref} className="btn">
          Download CSV
        </a>
      </div>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="empty">{busy ? "Loading…" : "No audit events match these filters."}</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Company</th>
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
                  <td className="cell-sub">{new Date(r.timestamp).toLocaleString("en-US")}</td>
                  <td>
                    <div>{r.userName ?? "—"}</div>
                    {r.userEmail && <div className="cell-sub">{r.userEmail}</div>}
                  </td>
                  <td className="cell-sub">{r.company ?? "—"}</td>
                  <td>{r.siteName ?? r.host}</td>
                  <td className="cell-sub">
                    {r.method} {r.path}
                  </td>
                  <td className="cell-sub">{r.status}</td>
                  <td>
                    <span className={`pill ${r.decision === "ALLOW" ? "ok" : "danger"}`}>
                      {r.decision === "ALLOW" ? "Allow" : `Deny${r.reason ? ` — ${r.reason}` : ""}`}
                    </span>
                  </td>
                  <td className="cell-sub">{r.clientIp ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-head">
        <button type="button" className="btn sm" onClick={() => load(filters, Math.max(0, offset - LIMIT))} disabled={!hasPrev || busy}>
          Previous
        </button>
        <button type="button" className="btn sm" onClick={() => load(filters, offset + LIMIT)} disabled={!hasNext || busy}>
          Next
        </button>
      </div>
    </section>
  );
}
