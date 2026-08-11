"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export interface Slice { label: string; value: number; color: string }

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function Donut({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p className="cell-sub">No data yet.</p>;
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="45%" height={130}>
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius={34} outerRadius={56} paddingAngle={2} stroke="none">
            {slices.map((s) => <Cell key={s.label} fill={s.color} />)}
          </Pie>
          <Tooltip contentStyle={TT} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.label}><span className="dot" style={{ background: s.color }} /> {s.label} · {s.value}</li>
        ))}
      </ul>
    </div>
  );
}
