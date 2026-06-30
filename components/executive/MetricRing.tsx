"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

export function MetricRing({ pct, color }: { pct: number; color: string }) {
  const data = [
    { value: pct, color },
    { value: 100 - pct, color: "var(--cream-200)" },
  ];
  return (
    <div className="exec-metric-ring">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="72%" outerRadius="100%" strokeWidth={0}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="exec-metric-ring-pct">{pct}%</div>
    </div>
  );
}
