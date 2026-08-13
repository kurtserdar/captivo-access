import type { DashboardStats } from "@/lib/dashboard/stats";
import type { Insights } from "@/lib/dashboard/insights";
import { KpiStrip } from "./kpi-strip";
import { Heatmap } from "./heatmap";
import { SessionStats } from "./session-stats";
import { AttentionPanel } from "./attention-panel";
import { AccessTrend } from "./charts/access-trend";
import { Donut } from "./charts/donut";
import { TopBars } from "./charts/top-bars";

const DENY_COLORS = ["var(--danger)", "var(--warn)", "var(--accent)", "#6f8bd6", "#a78bfa"];

export function DashboardInsights({ stats, insights }: { stats: DashboardStats; insights: Insights }) {
  const denySlices = insights.deny.reasons.map((r, i) => ({ label: r.label, value: r.count, color: DENY_COLORS[i % DENY_COLORS.length] }));
  const typeSlices = [
    { label: "Web", value: insights.typeMix.web, color: "var(--ok)" },
    { label: "Remote", value: insights.typeMix.remote, color: "var(--accent)" },
  ];
  return (
    <div className="dash-b">
      <KpiStrip stats={stats} insights={insights} />
      <div className="bento">
        <div className="card c-access"><div className="card-head"><div className="ch-title"><h2>Active vendors — 30 days</h2><span className="sub">accessed vs blocked</span></div></div><AccessTrend data={insights.trend} /></div>
        <div className="card c-heat"><Heatmap heatmap={insights.heatmap} /></div>
        <div className="card c-deny"><div className="card-head"><div className="ch-title"><h2>Deny reasons</h2><span className="sub">{insights.deny.total} total</span></div></div><Donut slices={denySlices} /></div>
        <div className="card c-type"><div className="card-head"><div className="ch-title"><h2>Access type mix</h2></div></div><Donut slices={typeSlices} /></div>
        <div className="card c-topr"><div className="card-head"><div className="ch-title"><h2>Top resources</h2><span className="sub">days active</span></div></div><TopBars items={insights.topResources} hrefBase="/admin/audit?siteId=" /></div>
        <div className="card c-topv"><div className="card-head"><div className="ch-title"><h2>Top vendors</h2><span className="sub">days active</span></div></div><TopBars items={insights.topVendors} hrefBase="/admin/audit?userId=" /></div>
        <div className="card c-sess"><SessionStats stats={insights.sessionStats} /></div>
        <div className="card c-att"><AttentionPanel insights={insights} /></div>
      </div>
    </div>
  );
}
