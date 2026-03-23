'use client';

// =============================================================================
// 10-Day Precipitation Probability Chart
// Matches iOS PrecipitationGraphView: Area + Line + Point, Catmull-Rom
// =============================================================================

import { useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ComposedChart, ReferenceLine, Dot,
} from 'recharts';
import { DailyForecast, PRECIP_TYPE_META } from '@/lib/weather/types';

interface Props {
  forecasts: DailyForecast[];
}

export default function PrecipitationGraph({ forecasts }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (forecasts.length < 2) {
    return (
      <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-6 text-white/50 text-sm flex items-center gap-2">
        📉 Not enough data for precipitation chart.
      </div>
    );
  }

  const data = forecasts.map((day, i) => {
    const date = new Date(day.time);
    const isToday = new Date().toDateString() === date.toDateString();
    const dayLabel = isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
    return {
      index: i,
      label: dayLabel,
      probability: day.precipProbability,
      precipType: day.precipType,
      accumulation: day.precipAccumulation,
      snowAccum: day.snowAccumulation,
      color: PRECIP_TYPE_META[day.precipType]?.color || '#3B82F6',
    };
  });

  const selected = selectedIdx != null ? data[selectedIdx] : null;

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-wider mb-3 px-2">
        <span>💧</span>
        <span>Precipitation</span>
      </div>

      {/* Chart */}
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
            onClick={(e) => {
              if (e?.activeTooltipIndex != null) setSelectedIdx(Number(e.activeTooltipIndex));
            }}
          >
            <defs>
              <linearGradient id="precipGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />

            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1.0]}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
              width={40}
            />

            {/* Layer 1: Area fill */}
            <Area
              type="natural"
              dataKey="probability"
              stroke="none"
              fill="url(#precipGradient)"
              animationDuration={800}
            />

            {/* Layer 2: Smooth curve line */}
            <Line
              type="natural"
              dataKey="probability"
              stroke="#3B82F6"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                return (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="#3B82F6"
                    stroke="rgba(0,0,0,0.3)"
                    strokeWidth={1}
                  />
                );
              }}
              activeDot={{ r: 6, fill: '#60A5FA', stroke: '#fff', strokeWidth: 2 }}
              animationDuration={800}
            />

            {/* Selected day indicator */}
            {selectedIdx != null && (
              <ReferenceLine
                x={data[selectedIdx]?.label}
                stroke="rgba(255,255,255,0.3)"
                strokeDasharray="5 3"
              />
            )}

            <Tooltip content={() => null} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Selected day detail */}
      {selected && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-white/5 flex items-center justify-between text-sm">
          <span className="text-white/70">
            {forecasts[selected.index] && new Date(forecasts[selected.index].time).toLocaleDateString('en-US', {
              weekday: 'long', month: 'short', day: 'numeric',
            })}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-blue-300 font-medium">
              💧 {Math.round(selected.probability * 100)}%
            </span>
            {selected.accumulation >= 0.1 && (
              <span className="text-white/60">
                {selected.precipType === 'snow' ? '❄️' : '🌧️'}{' '}
                {selected.accumulation >= 1
                  ? `${selected.accumulation.toFixed(1)}"`
                  : `${selected.accumulation.toFixed(2)}"`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
