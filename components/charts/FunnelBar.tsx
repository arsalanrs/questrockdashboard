"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export type FunnelStage = {
  label: string;
  count: number;
  color?: string;
};

const STAGE_COLORS = [
  "#0d5c3c",
  "#027a6b",
  "#168a3a",
  "#1d4ed8",
  "#6366f1",
  "#b45309",
  "#d42b2b",
];

function FunnelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: FunnelStage }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="lo-card rounded-lg px-3 py-2 text-sm shadow-lg">
      <span className="lo-heading font-semibold">{d.label}</span>
      <span className="lo-muted ml-2 tabular-nums">{d.count} loans</span>
    </div>
  );
}

type Props = {
  stages: FunnelStage[];
  height?: number;
};

export function FunnelBar({ stages, height = 200 }: Props) {
  const data = stages.map((s, i) => ({
    ...s,
    color: s.color ?? STAGE_COLORS[i % STAGE_COLORS.length],
  }));

  if (data.every((s) => s.count === 0)) {
    return <div className="lo-muted py-6 text-center text-sm">No active pipeline stages</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--lo-muted)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis hide />
        <Tooltip content={<FunnelTooltip />} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
