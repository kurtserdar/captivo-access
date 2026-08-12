import Link from "next/link";
import type { SiteHealthRow } from "@/lib/dashboard/stats";
import { siteStatePill } from "@/lib/dashboard/stats";
import { timeAgo } from "@/lib/format";

export function SiteHealthPanel({ sites }: { sites: SiteHealthRow[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Resource health</h2>
        <Link className="link-button" href="/admin/sites">All resources</Link>
      </div>
      {sites.length === 0 ? (
        <div className="empty">No resources yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Resource</th><th>Status</th><th>Latency</th><th>Checked</th></tr></thead>
            <tbody>
              {sites.map((site) => {
                const p = siteStatePill(site.probeOk);
                return (
                  <tr key={site.id}>
                    <td>{site.name}</td>
                    <td><span className={`pill ${p.tone}`}>{p.label}</span></td>
                    <td className="cell-sub">{site.probeOk && site.probeLatencyMs != null ? `${site.probeLatencyMs} ms` : "—"}</td>
                    <td className="cell-sub">{site.probedAt ? timeAgo(site.probedAt) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
