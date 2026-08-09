"use client";
import { useEffect, useState } from "react";
import { SiteAvatar } from "@/app/(app)/_shell/site-avatar";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { parseSchedule, formatSchedule } from "@/lib/access/schedule";
import { WithdrawRequestButton } from "./withdraw-request-button";

export interface AccessRow {
  id: string;
  siteName: string;
  hostname: string;
  startsAtISO: string | null;
  endsAtISO: string | null;
  schedule: unknown;
  status: "active" | "upcoming" | "off_hours" | "pending" | "denied";
  denyReason: string | null;
}

type View = "cards" | "list";
const STORE_KEY = "captivo:access-view";

const STATUS_PILL: Record<AccessRow["status"], { cls: string; label: string }> = {
  active: { cls: "ok", label: "Active" },
  upcoming: { cls: "warn", label: "Upcoming" },
  off_hours: { cls: "warn", label: "Outside hours" },
  pending: { cls: "warn", label: "Pending approval" },
  denied: { cls: "danger", label: "Denied" },
};

const GROUPS: { status: AccessRow["status"]; heading: string }[] = [
  { status: "active", heading: "Active" },
  { status: "upcoming", heading: "Upcoming" },
  { status: "off_hours", heading: "Outside current hours" },
  { status: "pending", heading: "Requests" },
];

function Window({ r }: { r: AccessRow }) {
  const s = parseSchedule(r.schedule);
  return (
    <>
      {r.startsAtISO ? <LocalTime iso={r.startsAtISO} /> : "Immediately"} →{" "}
      {r.endsAtISO ? <LocalTime iso={r.endsAtISO} /> : "Permanent"}
      {s ? <div className="cell-sub">{formatSchedule(s)}</div> : null}
    </>
  );
}

function StatusPill({ status }: { status: AccessRow["status"] }) {
  const p = STATUS_PILL[status];
  return <span className={`pill ${p.cls}`}>{p.label}</span>;
}

function RowAction({ r }: { r: AccessRow }) {
  if (r.status === "active")
    return (
      <a className="btn sm" href={`https://${r.hostname}`} target="_blank" rel="noopener noreferrer">
        Open ↗
      </a>
    );
  if (r.status === "pending") return <WithdrawRequestButton id={r.id} />;
  if (r.status === "denied" && r.denyReason) return <span className="cell-sub">{r.denyReason}</span>;
  return null;
}

export function AccessView({ rows }: { rows: AccessRow[] }) {
  const [view, setView] = useState<View>("cards");
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s === "cards" || s === "list") setView(s);
    } catch {
      /* ignore */
    }
  }, []);
  function choose(v: View) {
    setView(v);
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {
      /* ignore */
    }
  }

  // The "Requests" group covers both pending and denied rows.
  const rowsFor = (status: AccessRow["status"]) =>
    status === "pending"
      ? rows.filter((r) => r.status === "pending" || r.status === "denied")
      : rows.filter((r) => r.status === status);

  return (
    <div>
      <div className="section-head">
        <h2 style={{ margin: 0 }}>My access</h2>
        <div className="view-toggle">
          <button type="button" className={`btn sm ${view === "cards" ? "primary" : ""}`} aria-pressed={view === "cards"} onClick={() => choose("cards")}>
            Cards
          </button>
          <button type="button" className={`btn sm ${view === "list" ? "primary" : ""}`} aria-pressed={view === "list"} onClick={() => choose("list")}>
            List
          </button>
        </div>
      </div>

      {GROUPS.map(({ status, heading }) => {
        const group = rowsFor(status);
        if (group.length === 0) return null;
        return (
          <section key={status}>
            <h3>{heading}</h3>
            {view === "cards" ? (
              <div className="access-grid">
                {group.map((r) => (
                  <div key={r.id} className="card access-card">
                    <div className="access-card-head">
                      <SiteAvatar name={r.siteName} />
                      <span className="access-card-name">{r.siteName}</span>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="access-card-host cell-sub">
                      <span className="cell-truncate" title={r.hostname}>{r.hostname}</span>
                    </div>
                    <div className="cell-sub"><Window r={r} /></div>
                    <div className="access-card-foot"><RowAction r={r} /></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th>Window</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="cell-inline"><SiteAvatar name={r.siteName} /> {r.siteName}</span>
                        </td>
                        <td className="cell-sub"><Window r={r} /></td>
                        <td>
                          <StatusPill status={r.status} />
                          {r.status === "denied" && r.denyReason && <div className="cell-sub">{r.denyReason}</div>}
                        </td>
                        <td><RowAction r={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
