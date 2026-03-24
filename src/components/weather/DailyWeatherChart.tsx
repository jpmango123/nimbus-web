'use client';

// =============================================================================
// 7-Day Daily Weather Chart
// Matches iOS DailyWeatherChart: high/low lines, precip segments, weather icons
// =============================================================================

import { useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { DailyForecast, HourlyForecast, gaussianSmooth } from '@/lib/weather/types';
import { tempToColor, precipTypeColor } from '@/components/ui/TemperatureColor';
import WeatherIcon from '@/components/ui/WeatherIcon';

interface Props {
  forecasts: DailyForecast[];
  hourlyForecasts?: HourlyForecast[];
  unit?: 'F' | 'C';
}

export default function DailyWeatherChart({ forecasts, hourlyForecasts, unit = 'F' }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const days = forecasts.slice(0, 7);

  if (days.length < 2) return null;

  const tempConvert = (f: number) => unit === 'C' ? (f - 32) * 5 / 9 : f;

  // Build chart data with precipitation
  const data = days.map((day, i) => {
    const date = new Date(day.time);
    const isToday = new Date().toDateString() === date.toDateString();
    const label = isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });

    return {
      index: i,
      label,
      high: tempConvert(day.temperatureHigh),
      low: tempConvert(day.temperatureLow),
      precipProb: day.precipProbability,
      precipType: day.precipType,
      conditionDay: day.conditionDay,
      conditionNight: day.conditionNight,
      summary: day.summary,
      snowAccum: day.snowAccumulation,
      precipAccum: day.precipAccumulation,
    };
  });

  // Chart range — matches iOS: 18° below min, 22° above max, min 45° spread
  const allTemps = data.flatMap(d => [d.high, d.low]);
  const minTemp = Math.min(...allTemps);
  const maxTemp = Math.max(...allTemps);
  const spread = Math.max(maxTemp - minTemp, 45);
  const yMin = minTemp - 18;
  const yMax = yMin + spread + 22;

  // Precipitation in bottom 22% of chart
  const precipChartFraction = 0.22;
  const precipToY = (prob: number) => yMin + prob * (yMax - yMin) * precipChartFraction;

  // Smooth precipitation data
  const rawPrecip = data.map(d => d.precipProb);
  const smoothedPrecip = gaussianSmooth(rawPrecip, 1.5);

  const chartData = data.map((d, i) => ({
    ...d,
    smoothPrecip: precipToY(smoothedPrecip[i]),
    precipBase: yMin,
  }));

  const selected = selectedIdx != null ? days[selectedIdx] : null;

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-wider mb-3 px-2">
        <span>📅</span>
        <span>7-Day Forecast</span>
      </div>

      {/* Weather icons row — day icon on top, night icon below */}
      <div className="flex justify-between px-6 mb-1">
        {chartData.map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <WeatherIcon condition={d.conditionDay} size={18} />
            <WeatherIcon condition={d.conditionNight} size={12} />
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 15, left: 15, bottom: 0 }}
            onClick={(e) => {
              if (e?.activeTooltipIndex != null) setSelectedIdx(Number(e.activeTooltipIndex));
            }}
          >
            <defs>
              <linearGradient id="precipAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />

            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
            />
            <YAxis hide domain={[yMin, yMax]} />

            {/* Precip area */}
            <Area
              type="monotone"
              dataKey="smoothPrecip"
              stroke="none"
              fill="url(#precipAreaGrad)"
              baseValue={yMin}
              animationDuration={600}
            />

            {/* High temp line */}
            <Line
              type="natural"
              dataKey="high"
              stroke="#FF8A6E"
              strokeWidth={2.5}
              strokeLinecap="round"
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: { high: number } };
                return (
                  <circle
                    key={`h-${cx}`}
                    cx={cx}
                    cy={cy}
                    r={3.5}
                    fill={tempToColor(unit === 'C' ? payload.high * 9 / 5 + 32 : payload.high)}
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth={1}
                  />
                );
              }}
              animationDuration={600}
            />

            {/* Low temp line */}
            <Line
              type="natural"
              dataKey="low"
              stroke="#8BA3D4"
              strokeWidth={2}
              strokeLinecap="round"
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: { low: number } };
                return (
                  <circle
                    key={`l-${cx}`}
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill={tempToColor(unit === 'C' ? payload.low * 9 / 5 + 32 : payload.low)}
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth={1}
                  />
                );
              }}
              animationDuration={600}
            />

            {selectedIdx != null && (
              <ReferenceLine
                x={chartData[selectedIdx]?.label}
                stroke="rgba(255,255,255,0.2)"
                strokeDasharray="5 3"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* High/Low labels */}
      <div className="flex justify-between px-6 mt-1">
        {chartData.map((d, i) => (
          <div key={i} className="flex flex-col items-center text-xs tabular-nums">
            <span style={{ color: tempToColor(unit === 'C' ? d.high * 9 / 5 + 32 : d.high) }} className="font-semibold">
              {Math.round(d.high)}°
            </span>
            <span style={{ color: tempToColor(unit === 'C' ? d.low * 9 / 5 + 32 : d.low) }} className="opacity-70">
              {Math.round(d.low)}°
            </span>
          </div>
        ))}
      </div>

      {/* Selected day detail */}
      {selected && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-white/5 grid grid-cols-4 gap-2 text-xs text-white/70">
          <div>
            <div className="text-white/40">Date</div>
            <div>{new Date(selected.time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          </div>
          <div>
            <div className="text-white/40">Precip</div>
            <div>{Math.round(selected.precipProbability * 100)}%</div>
          </div>
          <div>
            <div className="text-white/40">Wind</div>
            <div>{Math.round(selected.windSpeed)} mph</div>
          </div>
          <div>
            <div className="text-white/40">Humidity</div>
            <div>{Math.round(selected.humidity * 100)}%</div>
          </div>
        </div>
      )}
    </div>
  );
}
