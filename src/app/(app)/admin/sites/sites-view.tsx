"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteAvatar } from "@/app/(app)/_shell/site-avatar";
import { TestConnectionButton } from "./test-connection-button";
import { DeleteSiteButton } from "./delete-site-button";
import { CopyButton } from "@/app/(app)/_shell/copy-button";

export interface SiteRow {
  id: string;
  name: string;
  hostname: string;
  upstreamUrl: string | null;
  description: string | null;
  accessMode: "TRANSPARENT" | "GATEWAY";
  connectorName: string;
  grantCount: number;
  probeOk: boolean | null;
  probeDetail: string | null;
  probeLatencyMs: number | null;
  probedAgo: string | null;
}

type View = "cards" | "list";
const STORE_KEY = "captivo:sites-view";

function GatewayPill({ accessMode }: { accessMode: SiteRow["accessMode"] }) {
  if (accessMode !== "GATEWAY") return null;
  return <span className="pill neutral">Gateway</span>;
}

function HealthPill({ s }: { s: SiteRow }) {
  return (
    <>
      {s.upstreamUrl == null ? (
        <span className="pill neutral">No address</span>
      ) : s.probeOk == null ? (
        <span className="pill neutral">Not checked</span>
      ) : s.probeOk ? (
        <span className="pill ok">Reachable</span>
      ) : (
        <span className="pill danger">Unreachable</span>
      )}
      {s.probeDetail && s.probeOk === false && <div className="cell-sub">{s.probeDetail}</div>}
      {s.probeOk === true && s.probeLatencyMs != null && <div className="cell-sub">{s.probeLatencyMs} ms</div>}
      {s.probedAgo && <div className="cell-sub">{s.probedAgo}</div>}
    </>
  );
}

function Actions({ s }: { s: SiteRow }) {
  return (
    <div className="row-actions">
      <TestConnectionButton siteId={s.id} />
      <Link href={`/admin/sites/${s.id}/edit`} className="btn sm">Edit</Link>
      <DeleteSiteButton id={s.id} name={s.name} grantCount={s.grantCount} />
    </div>
  );
}

export function SitesView({ sites }: { sites: SiteRow[] }) {
  const [view, setView] = useState<View>("cards");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === "cards" || saved === "list") setView(saved);
    } catch { /* ignore */ }
  }, []);

  function choose(v: View) {
    setView(v);
    try { localStorage.setItem(STORE_KEY, v); } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="section-head">
        <h2>Configured sites</h2>
        <div className="view-toggle">
          <button type="button" className={`btn sm ${view === "cards" ? "primary" : ""}`} aria-pressed={view === "cards"} onClick={() => choose("cards")}>Cards</button>
          <button type="button" className={`btn sm ${view === "list" ? "primary" : ""}`} aria-pressed={view === "list"} onClick={() => choose("list")}>List</button>
        </div>
      </div>

      {view === "cards" ? (
        <div className="site-grid">
          {sites.map((s) => (
            <div key={s.id} className="card site-card">
              <div className="site-card-head">
                <SiteAvatar name={s.name} />
                <div className="site-card-title">
                  <div className="site-card-name">
                    {s.name} <GatewayPill accessMode={s.accessMode} />
                  </div>
                  <div className="cell-sub site-card-host">
                    <span className="cell-truncate" title={s.hostname}>{s.hostname}</span>
                    <CopyButton value={s.hostname} label="Copy" />
                  </div>
                </div>
              </div>

              <dl className="site-card-meta">
                <div><dt>Connector</dt><dd>{s.connectorName}</dd></div>
                {s.upstreamUrl && (
                  <div>
                    <dt>Internal</dt>
                    <dd className="cell-inline"><span className="cell-truncate" title={s.upstreamUrl}>{s.upstreamUrl}</span><CopyButton value={s.upstreamUrl} label="Copy" /></dd>
                  </div>
                )}
                {s.description && <div><dt>Notes</dt><dd>{s.description}</dd></div>}
                <div><dt>Health</dt><dd><HealthPill s={s} /></dd></div>
              </dl>

              <Actions s={s} />
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Hostname</th><th>Connector</th><th>Internal address</th><th>Description</th><th>Health</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="cell-inline"><SiteAvatar name={s.name} /> {s.name} <GatewayPill accessMode={s.accessMode} /></span>
                  </td>
                  <td className="cell-sub">
                    <span className="cell-inline"><span className="cell-truncate" title={s.hostname}>{s.hostname}</span><CopyButton value={s.hostname} label="Copy" /></span>
                  </td>
                  <td>{s.connectorName}</td>
                  <td className="cell-sub">
                    {s.upstreamUrl && (<span className="cell-inline"><span className="cell-truncate" title={s.upstreamUrl}>{s.upstreamUrl}</span><CopyButton value={s.upstreamUrl} label="Copy" /></span>)}
                  </td>
                  <td className="cell-sub">{s.description ?? "—"}</td>
                  <td><HealthPill s={s} /></td>
                  <td><Actions s={s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
