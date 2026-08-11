import type { DashboardStats } from "@/lib/dashboard/stats";
import type { Insights } from "@/lib/dashboard/insights";

function sinceLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const max = Math.max(1, ...points);
  const w = 60, h = 18;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const pts = points.map((p, i) => `${(i * step).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`).join(" ");
  return <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} /></svg>;
}

export function KpiStrip({ stats, insights }: { stats: DashboardStats; insights: Insights }) {
  const longest = insights.activeSessions.longestStartedAt ? sinceLabel(insights.activeSessions.longestStartedAt) : null;
  return (
    <div className="kpis">
      <div className="kpi"><div className="k">Connectors</div><div className="v">{stats.connectorsOnline}/{stats.connectors}</div><div className="s">{stats.connectorsOnline === stats.connectors ? "all online" : `${stats.connectors - stats.connectorsOnline} offline`}</div></div>
      <div className="kpi"><div className="k">Resources</div><div className="v">{stats.sitesReachable}/{stats.sites}</div><div className="s">{stats.sitesDown > 0 ? `${stats.sitesDown} down` : "reachable"}</div></div>
      <div className="kpi"><div className="k">Active grants</div><div className="v">{stats.activeGrants}</div><div className="s">{stats.pending > 0 ? `${stats.pending} pending approval` : "no pending"}</div></div>
      <div className="kpi"><div className="k">Sessions now</div><div className="v">{insights.activeSessions.count}</div><div className="s">{longest ? `longest ${longest}` : "none active"}</div></div>
      <div className="kpi"><div className="k">Denials 30d</div><div className="v" style={{ color: insights.deny.total > 0 ? "var(--danger)" : undefined }}>{insights.deny.total}</div><Sparkline points={insights.trend.map((d) => d.deny)} color="var(--danger)" /></div>
      <div className="kpi"><div className="k">Active vendors 30d</div><div className="v">{insights.activeVendors.count}</div><Sparkline points={insights.activeVendors.series} color="var(--accent)" /></div>
    </div>
  );
}
