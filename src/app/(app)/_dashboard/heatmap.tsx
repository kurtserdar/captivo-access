import type { Insights } from "@/lib/dashboard/insights";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Heatmap({ heatmap }: { heatmap: Insights["heatmap"] }) {
  const max = Math.max(1, heatmap.max);
  return (
    <>
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
    </>
  );
}
