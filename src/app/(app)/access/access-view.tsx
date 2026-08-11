"use client";
import { useEffect, useState, type ReactNode } from "react";
import { SiteAvatar } from "@/app/(app)/_shell/site-avatar";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { parseSchedule, formatSchedule } from "@/lib/access/schedule";
import { WithdrawRequestButton } from "./withdraw-request-button";

export interface AccessRow {
  id: string;
  siteId: string;
  siteName: string;
  hostname: string;
  accessMode: string;
  hasLogo: boolean;
  startsAtISO: string | null;
  endsAtISO: string | null;
  schedule: unknown;
  status: "active" | "upcoming" | "off_hours" | "pending" | "denied";
  denyReason: string | null;
  recorded: boolean;
}

function RecordedTag({ r }: { r: AccessRow }) {
  if (!r.recorded) return null;
  return (
    <div className="cell-sub" title="Your activity in this app is recorded for security and compliance.">
      <span style={{ color: "var(--danger)" }}>●</span> Recorded
    </div>
  );
}

type View = "cards" | "list";
const STORE_KEY = "captivo:access-view";
const FAV_KEY = "captivo:access-favorites";

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

function FavStar({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`fav-star${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 17.77 6.8 20.51l.99-5.79-4.21-4.1 5.82-.85z" />
      </svg>
    </button>
  );
}

function RowAction({ r }: { r: AccessRow }) {
  if (r.status === "active") {
    // GATEWAY (remote desktop) sites open the native in-Captivo session page; web
    // apps open directly.
    const href = r.accessMode === "GATEWAY" ? `/gateway/${r.siteId}/session` : `https://${r.hostname}`;
    return (
      <a className="btn sm" href={href} target="_blank" rel="noopener noreferrer">
        Open ↗
      </a>
    );
  }
  if (r.status === "pending") return <WithdrawRequestButton id={r.id} />;
  if (r.status === "denied" && r.denyReason) return <span className="cell-sub">{r.denyReason}</span>;
  return null;
}

export function AccessView({ rows }: { rows: AccessRow[] }) {
  const [view, setView] = useState<View>("cards");
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [favReady, setFavReady] = useState(false);
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s === "cards" || s === "list") setView(s);
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) {
        const arr: unknown = JSON.parse(raw);
        if (Array.isArray(arr)) setFavs(new Set(arr.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      /* ignore */
    }
    setFavReady(true);
  }, []);
  function choose(v: View) {
    setView(v);
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {
      /* ignore */
    }
  }
  function toggleFav(siteId: string) {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // The "Requests" group covers both pending and denied rows.
  const rowsFor = (status: AccessRow["status"]) =>
    status === "pending"
      ? rows.filter((r) => r.status === "pending" || r.status === "denied")
      : rows.filter((r) => r.status === status);

  const isFav = (r: AccessRow) => favReady && favs.has(r.siteId);
  const favRows = favReady ? rows.filter((r) => favs.has(r.siteId)) : [];

  function renderSection(key: string, heading: ReactNode, group: AccessRow[]) {
    return (
      <section key={key}>
        <h3>{heading}</h3>
        {view === "cards" ? (
          <div className="access-grid">
            {group.map((r) => (
              <div key={r.id} className="card access-card">
                <div className="access-card-head">
                  <SiteAvatar name={r.siteName} siteId={r.siteId} hasLogo={r.hasLogo} />
                  <span className="access-card-name">{r.siteName}</span>
                  <StatusPill status={r.status} />
                  <FavStar on={isFav(r)} onClick={() => toggleFav(r.siteId)} />
                </div>
                <div className="access-card-host cell-sub">
                  <span className="cell-truncate" title={r.hostname}>{r.hostname}</span>
                </div>
                <div className="cell-sub"><Window r={r} /></div>
                <RecordedTag r={r} />
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
                      <span className="cell-inline"><SiteAvatar name={r.siteName} siteId={r.siteId} hasLogo={r.hasLogo} /> {r.siteName}</span>
                    </td>
                    <td className="cell-sub"><Window r={r} /></td>
                    <td>
                      <StatusPill status={r.status} />
                      {r.status === "denied" && r.denyReason && <div className="cell-sub">{r.denyReason}</div>}
                      <RecordedTag r={r} />
                    </td>
                    <td>
                      <span className="row-actions"><FavStar on={isFav(r)} onClick={() => toggleFav(r.siteId)} /><RowAction r={r} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

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

      {favRows.length > 0 && renderSection("favorites", <><span className="fav-star-heading">★</span> Favorites</>, favRows)}

      {GROUPS.map(({ status, heading }) => {
        const group = rowsFor(status).filter((r) => !isFav(r));
        if (group.length === 0) return null;
        return renderSection(status, heading, group);
      })}
    </div>
  );
}
