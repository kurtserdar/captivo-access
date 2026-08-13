"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { TrendDay } from "@/lib/dashboard/insights";

const TT = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "12px", color: "var(--fg)" } as const;

export function AccessTrend({ data }: { data: TrendDay[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const total = data.reduce((s, d) => s + d.allow + d.deny, 0);
  if (total === 0) return <p className="cell-sub">No access in the last 30 days.</p>;
  const chartData = data.map((d) => ({ date: d.date.slice(5), fullDate: d.date, allow: d.allow, deny: d.deny }));
  const toggle = (o: unknown) => {
    const k = (o as { dataKey?: string }).dataKey;
    if (k) setHidden((h) => ({ ...h, [k]: !h[k] }));
  };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={chartData}
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        style={{ cursor: "pointer" }}
        onClick={(state) => {
          const i = (state as { activeTooltipIndex?: number | null })?.activeTooltipIndex;
          if (i == null || !chartData[i]) return;
          const day = chartData[i].fullDate;
          router.push(`/admin/audit?from=${day}T00:00:00.000Z&to=${day}T23:59:59.999Z`);
        }}
      >
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} interval={4} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TT} cursor={{ fill: "var(--surface-2)" }} />
        <Legend onClick={toggle} wrapperStyle={{ fontSize: "12px", cursor: "pointer" }} />
        <Bar dataKey="allow" name="Accessed" fill="var(--ok)" hide={hidden.allow} activeBar={{ opacity: 0.85 }} />
        <Bar dataKey="deny" name="Blocked" fill="var(--danger)" hide={hidden.deny} activeBar={{ opacity: 0.85 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}
