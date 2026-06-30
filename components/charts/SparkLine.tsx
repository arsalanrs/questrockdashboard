"use client";

import { AreaChart, Area, ResponsiveContainer } from "recharts";

type Props = {
  data: number[];
  color?: string;
  height?: number;
};

export function SparkLine({ data, color = "var(--lo-teal)", height = 40 }: Props) {
  if (!data.length) return null;

  const points = data.map((value, i) => ({ i, value }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill="url(#sparkFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
