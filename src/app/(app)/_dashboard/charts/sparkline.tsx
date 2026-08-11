"use client";
import { useState } from "react";

export function Sparkline({ points, color }: { points: number[]; color: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(1, ...points);
  const w = 60, h = 18;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const xy = points.map((p, i) => ({ x: i * step, y: h - (p / max) * h, v: p }));
  const line = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <span className="spark-wrap">
      <svg
        className="kpi-spark"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - r.left) / r.width) * w;
          const idx = Math.round(rel / step);
          setHi(Math.max(0, Math.min(points.length - 1, idx)));
        }}
        onMouseLeave={() => setHi(null)}
      >
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
        {hi != null && <circle cx={xy[hi].x} cy={xy[hi].y} r={2} fill={color} />}
      </svg>
      {hi != null && <span className="spark-tip">{xy[hi].v}</span>}
    </span>
  );
}
