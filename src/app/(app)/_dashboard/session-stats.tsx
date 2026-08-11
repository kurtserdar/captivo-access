import type { Insights } from "@/lib/dashboard/insights";

export function SessionStats({ stats }: { stats: Insights["sessionStats"] }) {
  return (
    <>
      <div className="card-head"><div className="ch-title"><h2>Session activity</h2><span className="sub">last 30 days</span></div></div>
      <div className="sess3">
        <div><div className="v">{stats.recordings}</div><div className="k">recordings</div></div>
        <div><div className="v">{stats.totalHours}h</div><div className="k">captured</div></div>
        <div><div className="v">{stats.avgMinutes}m</div><div className="k">avg length</div></div>
      </div>
    </>
  );
}
