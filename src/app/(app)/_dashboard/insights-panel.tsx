import type { Insights, TrendDay, Labeled } from "@/lib/dashboard/insights";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TrendChart({ trend }: { trend: TrendDay[] }) {
  const max = Math.max(1, ...trend.map((d) => d.allow + d.deny));
  const allow = trend.reduce((s, d) => s + d.allow, 0);
  const deny = trend.reduce((s, d) => s + d.deny, 0);
  const W = 100, H = 40, colW = W / trend.length, bw = colW * 0.72;
  return (
    <div className="card">
      <div className="card-head"><div className="ch-title"><h2>Access (30 days)</h2><span className="sub">{allow} allowed · {deny} denied</span></div></div>
      {allow + deny === 0 ? (
        <p className="cell-sub">No access in the last 30 days.</p>
      ) : (
        <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Daily allowed vs denied access, last 30 days">
          {trend.map((d, i) => {
            const total = d.allow + d.deny;
            if (total === 0) return null;
            const h = (total / max) * H;
            const allowH = (d.allow / total) * h;
            const x = i * colW + (colW - bw) / 2;
            return (
              <g key={d.date}>
                {d.deny > 0 && <rect x={x} y={H - h} width={bw} height={h - allowH} className="trend-deny" />}
                {d.allow > 0 && <rect x={x} y={H - allowH} width={bw} height={allowH} className="trend-allow" />}
              </g>
            );
          })}
        </svg>
      )}
      <div className="chart-legend"><span className="dot ok" /> Allowed <span className="dot danger" /> Denied</div>
    </div>
  );
}

function Heatmap({ heatmap }: { heatmap: Insights["heatmap"] }) {
  const max = Math.max(1, heatmap.max);
  return (
    <div className="card">
      <div className="card-head"><div className="ch-title"><h2>When vendors connect</h2><span className="sub">day × hour (UTC), last 30 days</span></div></div>
      <div className="heatmap">
        {heatmap.grid.map((rowVals, dow) => (
          <div key={dow} className="heatmap-row">
            <span className="heatmap-day">{DAYS[dow]}</span>
            {rowVals.map((v, h) => (
              <span key={h} className="heatmap-cell" style={{ opacity: v === 0 ? 0.06 : 0.18 + 0.82 * (v / max) }} title={`${DAYS[dow]} ${String(h).padStart(2, "0")}:00 UTC — ${v}`} />
            ))}
          </div>
        ))}
        <div className="heatmap-axis"><span className="heatmap-day" />{[0, 6, 12, 18].map((h) => <span key={h}>{h}:00</span>)}</div>
      </div>
    </div>
  );
}

function TopList({ title, items, empty }: { title: string; items: Labeled[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="card">
      <div className="card-head"><div className="ch-title"><h2>{title}</h2></div></div>
      {items.length === 0 ? (
        <p className="cell-sub">{empty}</p>
      ) : (
        <ul className="toplist">
          {items.map((it) => (
            <li key={it.label}>
              <span className="toplist-label cell-truncate" title={it.label}>{it.label}</span>
              <span className="toplist-bar"><span style={{ width: `${(it.count / max) * 100}%` }} /></span>
              <span className="toplist-count">{it.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sinceLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function AttentionPanel({ data }: { data: Insights }) {
  const { deny, ipFlags, expiring, activeSessions } = data;
  return (
    <div className="card attention">
      <div className="card-head"><div className="ch-title"><h2>Attention</h2><span className="sub">security &amp; ops</span></div></div>

      <div className="attention-block">
        <div className="attention-k">Denials (30d)</div>
        <div className="attention-v">{deny.total}</div>
        {deny.reasons.map((r) => <div key={r.label} className="cell-sub">{r.label} · {r.count}</div>)}
      </div>

      <div className="attention-block">
        <div className="attention-k">IP-diversity flags</div>
        {ipFlags.length === 0 ? <div className="cell-sub">None</div> : ipFlags.map((f) => (
          <div key={f.userEmail} className="cell-sub"><span className="pill warn">{f.ipCount} IPs</span> {f.userEmail}</div>
        ))}
      </div>

      <div className="attention-block">
        <div className="attention-k">Grants expiring (7d)</div>
        <div className="attention-v">{expiring.count}</div>
        {expiring.soonest.map((g, i) => <div key={i} className="cell-sub">{g.userEmail} → {g.siteName}</div>)}
      </div>

      <div className="attention-block">
        <div className="attention-k">Active sessions</div>
        <div className="attention-v">{activeSessions.count}</div>
        {activeSessions.longestStartedAt && <div className="cell-sub">longest: {sinceLabel(activeSessions.longestStartedAt)}</div>}
      </div>
    </div>
  );
}

export function InsightsPanel({ data }: { data: Insights }) {
  return (
    <div className="insights">
      <TrendChart trend={data.trend} />
      <div className="insights-grid">
        <Heatmap heatmap={data.heatmap} />
        <AttentionPanel data={data} />
      </div>
      <div className="insights-grid">
        <TopList title="Top resources" items={data.topResources} empty="No resource access yet." />
        <TopList title="Top vendors" items={data.topVendors} empty="No vendor access yet." />
      </div>
    </div>
  );
}
