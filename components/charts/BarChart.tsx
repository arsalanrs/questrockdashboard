"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export type BarChartItem = {
  label: string;
  value: number;
  color?: string;
};

const DEFAULT_COLORS = ["#0d5c3c", "#027a6b", "#168a3a", "#1d4ed8", "#b45309", "#d42b2b"];

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BarChartItem }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="lo-card rounded-lg px-3 py-2 text-sm shadow-lg">
      <span className="lo-heading font-semibold">{d.label}</span>
      <span className="lo-muted ml-2 tabular-nums">{d.value}</span>
    </div>
  );
}

type Props = {
  data: BarChartItem[];
  /** Horizontal bars (default) or vertical */
  layout?: "horizontal" | "vertical";
  height?: number;
  valueSuffix?: string;
};

export function DashboardBarChart({
  data,
  layout = "horizontal",
  height = 220,
  valueSuffix = "",
}: Props) {
  const chartData = data.map((d, i) => ({
    ...d,
    color: d.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  }));

  if (chartData.length === 0) {
    return <div className="lo-muted py-8 text-center text-sm">No data</div>;
  }

  const isHorizontal = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={chartData}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 12, left: isHorizontal ? 8 : 0, bottom: 4 }}
      >
        {isHorizontal ? (
          <>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={100}
              tick={{ fill: "var(--lo-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </>
        ) : (
          <>
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--lo-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={60}
            />
            <YAxis hide />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={28}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </>
        )}
        <Tooltip
          content={<ChartTooltip />}
          formatter={(v) => [`${Number(v ?? 0)}${valueSuffix}`, ""]}
        />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
