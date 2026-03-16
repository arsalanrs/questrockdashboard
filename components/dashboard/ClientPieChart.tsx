"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export type PieSlice = {
  name: string;
  value: number;
  color: string;
  percent?: number;
};

function TooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { percent?: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const pct = d.payload.percent != null ? (d.payload.percent * 100).toFixed(1) : "";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg">
      <span className="font-semibold">{d.name}</span>
      <span className="ml-2 tabular-nums">{d.value}</span>
      {pct && <span className="ml-1 text-mutedForeground">({pct}%)</span>}
    </div>
  );
}

export default function ClientPieChart({
  data,
  width = 180,
  height = 180,
  innerRadius,
  outerRadius,
}: {
  data: PieSlice[];
  width?: number | `${number}%`;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}) {
  return (
    <ResponsiveContainer width={width ?? 180} height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius ?? height * 0.25}
          outerRadius={outerRadius ?? height * 0.42}
          paddingAngle={3}
          dataKey="value"
          stroke="none"
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Pie>
        <Tooltip content={<TooltipContent />} />
      </PieChart>
    </ResponsiveContainer>
  );
}
