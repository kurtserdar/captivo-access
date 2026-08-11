import type { Insights } from "@/lib/dashboard/insights";

export function AttentionPanel({ insights }: { insights: Insights }) {
  const { ipFlags, expiring, topDenied } = insights;
  return (
    <>
      <div className="card-head"><div className="ch-title"><h2>Attention</h2><span className="sub">security &amp; ops</span></div></div>
      <div className="att">
        <div>
          <div className="ak">IP-diversity flags</div>
          {ipFlags.length === 0 ? <div className="cell-sub">None</div> : ipFlags.map((f) => (
            <div key={f.userEmail} className="att-row"><span className="pill warn">{f.ipCount} IPs</span> {f.userEmail}</div>
          ))}
        </div>
        <div>
          <div className="ak">Grants expiring (7d)</div>
          {expiring.count === 0 ? <div className="cell-sub">None</div> : expiring.soonest.map((g, i) => (
            <div key={i} className="att-row">{g.userEmail} → {g.siteName}</div>
          ))}
        </div>
        <div>
          <div className="ak">Top denied</div>
          {topDenied.length === 0 ? <div className="cell-sub">None</div> : topDenied.map((d) => (
            <div key={d.label} className="att-row"><span className="pill danger">{d.count}</span> {d.label}</div>
          ))}
        </div>
      </div>
    </>
  );
}
