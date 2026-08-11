"use client";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { RefCount } from "@/lib/dashboard/insights";

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function TopBars({ items, hrefFor }: { items: RefCount[]; hrefFor: (item: RefCount) => string }) {
  const router = useRouter();
  if (items.length === 0) return <p className="cell-sub">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(96, items.length * 36)}>
      <BarChart data={items} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TT} cursor={{ fill: "var(--surface-2)" }} />
        <Bar
          dataKey="count"
          fill="var(--accent)"
          radius={[0, 3, 3, 0]}
          cursor="pointer"
          activeBar={{ fill: "var(--accent)", opacity: 0.85 }}
          onClick={(_, index) => { const it = items[index]; if (it) router.push(hrefFor(it)); }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
