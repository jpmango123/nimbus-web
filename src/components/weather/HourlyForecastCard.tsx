'use client';

// =============================================================================
// Hourly Forecast Card — Scrollable 48-hour chart
// Matches iOS HourlyForecastCard: temp curve + precip overlay + night shading + storm markers
// =============================================================================

import { useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, ResponsiveContainer,
  ReferenceLine, ReferenceArea,
} from 'recharts';
import { HourlyForecast, StormEvent, gaussianSmooth } from '@/lib/weather/types';
import { tempToColor } from '@/components/ui/TemperatureColor';
import WeatherIcon from '@/components/ui/WeatherIcon';

interface Props {
  hourly: HourlyForecast[];
  storms?: StormEvent[];
  unit?: 'F' | 'C';
}

export default function HourlyForecastCard({ hourly, storms, unit = 'F' }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const hours = hourly.slice(0, 48);

  if (hours.length < 3) return null;

  const tempConvert = (f: number) => unit === 'C' ? (f - 32) * 5 / 9 : f;

  // Build data
  const data = hours.map((h, i) => {
    const date = new Date(h.time);
    const hourNum = date.getHours();
    const isNow = i === 0;
    let label = '';
    if (isNow) label = 'Now';
    else if (hourNum === 0) label = date.toLocaleDateString('en-US', { weekday: 'short' });
    else if (i % 3 === 0) label = date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });

    return {
      index: i,
      label,
      temp: tempConvert(h.temperature),
      precipProb: h.precipProbability,
      precipType: h.precipType,
      condition: h.condition,
      isDaylight: h.isDaylight,
      windSpeed: h.windSpeed,
      humidity: h.humidity,
      uvIndex: h.uvIndex,
      time: h.time,
    };
  });

  // Chart range
  const temps = data.map(d => d.temp);
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const spread = Math.max(maxT - minT, 15);
  const bottomPad = spread * 0.5; // room for precip overlay
  const yMin = minT - bottomPad;
  const yMax = maxT + spread * 0.15;

  // Precip in bottom 28%
  const precipFraction = 0.28;
  const precipToY = (prob: number) => yMin + prob * (yMax - yMin) * precipFraction;

  // Smooth precipitation
  const rawPrecip = data.map(d => d.precipProb);
  const smoothedPrecip = gaussianSmooth(rawPrecip, 2.0);

  const chartData = data.map((d, i) => ({
    ...d,
    smoothPrecip: precipToY(smoothedPrecip[i]),
  }));

  // Find night blocks (contiguous runs of !isDaylight)
  const nightBlocks: { startIdx: number; endIdx: number }[] = [];
  let nightStart: number | null = null;
  for (let i = 0; i < chartData.length; i++) {
    if (!chartData[i].isDaylight) {
      if (nightStart === null) nightStart = i;
    } else {
      if (nightStart !== null) {
        nightBlocks.push({ startIdx: nightStart, endIdx: i - 1 });
        nightStart = null;
      }
    }
  }
  if (nightStart !== null) nightBlocks.push({ startIdx: nightStart, endIdx: chartData.length - 1 });

  // Map storm events to chart indices
  const stormRanges: { startIdx: number; endIdx: number; label: string }[] = [];
  if (storms) {
    for (const storm of storms) {
      const stormStart = new Date(storm.startTime).getTime();
      const stormEnd = new Date(storm.endTime).getTime();
      let si = -1, ei = -1;
      for (let i = 0; i < hours.length; i++) {
        const t = new Date(hours[i].time).getTime();
        if (si < 0 && t >= stormStart) si = i;
        if (t <= stormEnd) ei = i;
      }
      if (si >= 0 && ei >= 0) {
        const typeIcon = storm.dominantPrecipType === 'snow' ? '❄️' : storm.dominantPrecipType === 'sleet' ? '🌨️' : '🌧️';
        stormRanges.push({ startIdx: si, endIdx: ei, label: `${typeIcon} ${storm.totalAccumulation.toFixed(2)}"` });
      }
    }
  }

  const selected = selectedIdx != null ? chartData[selectedIdx] : null;

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-wider mb-3 px-2">
        <span>🕐</span>
        <span>Hourly Forecast</span>
      </div>

      {/* Scrollable chart */}
      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-white/10">
        <div style={{ width: Math.max(hours.length * 28, 600), height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
              onClick={(e) => {
                if (e?.activeTooltipIndex != null) setSelectedIdx(Number(e.activeTooltipIndex));
              }}
            >
              <defs>
                <linearGradient id="hourlyPrecipGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 9 }}
                interval={0}
              />
              <YAxis hide domain={[yMin, yMax]} />

              {/* Night shading — subtle dark overlay for nighttime hours */}
              {nightBlocks.map((block, bi) => (
                <ReferenceArea
                  key={`night-${bi}`}
                  x1={chartData[block.startIdx]?.label}
                  x2={chartData[block.endIdx]?.label}
                  y1={yMin}
                  y2={yMax}
                  fill="#000"
                  fillOpacity={0.15}
                  strokeOpacity={0}
                />
              ))}

              {/* Storm event annotations — highlighted regions */}
              {stormRanges.map((storm, si) => (
                <ReferenceArea
                  key={`storm-${si}`}
                  x1={chartData[storm.startIdx]?.label}
                  x2={chartData[storm.endIdx]?.label}
                  y1={yMin}
                  y2={yMax}
                  fill="#EF4444"
                  fillOpacity={0.08}
                  stroke="#EF4444"
                  strokeOpacity={0.2}
                  strokeDasharray="3 3"
                  label={{ value: storm.label, position: 'insideTop', fill: 'rgba(255,255,255,0.5)', fontSize: 9 }}
                />
              ))}

              {/* Precip area overlay */}
              <Area
                type="natural"
                dataKey="smoothPrecip"
                stroke="none"
                fill="url(#hourlyPrecipGrad)"
                baseValue={yMin}
                animationDuration={600}
              />

              {/* Temperature curve */}
              <Line
                type="natural"
                dataKey="temp"
                stroke="#FF8A6E"
                strokeWidth={2.5}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 5, fill: '#FF8A6E', stroke: '#fff', strokeWidth: 2 }}
                animationDuration={600}
              />

              {selectedIdx != null && (
                <ReferenceLine
                  x={chartData[selectedIdx]?.label || ''}
                  stroke="rgba(255,255,255,0.2)"
                  strokeDasharray="5 3"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Selected hour detail */}
      {selected && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-white/5 flex items-center justify-between text-xs text-white/70">
          <div className="flex items-center gap-2">
            <WeatherIcon condition={selected.condition} size={16} />
            <span>{new Date(selected.time).toLocaleTimeString('en-US', {
              weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
            })}</span>
          </div>
          <div className="flex items-center gap-3">
            <span style={{ color: tempToColor(unit === 'C' ? selected.temp * 9 / 5 + 32 : selected.temp) }} className="font-medium">
              {Math.round(selected.temp)}°
            </span>
            <span>💧 {Math.round(selected.precipProb * 100)}%</span>
            <span>💨 {Math.round(selected.windSpeed)} mph</span>
          </div>
        </div>
      )}
    </div>
  );
}
