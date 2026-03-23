'use client';

// =============================================================================
// Minutely Precipitation Chart — Next 2 hours intensity
// Matches iOS MinutelyPrecipitationView: Gaussian smoothed, intensity-based
// =============================================================================

import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Line, ComposedChart,
} from 'recharts';
import { MinutelyForecast, gaussianSmooth } from '@/lib/weather/types';
import { precipTypeColor } from '@/components/ui/TemperatureColor';

interface Props {
  minutely: MinutelyForecast[];
}

function intensityLabel(maxIntensity: number): { label: string; ceiling: number } {
  if (maxIntensity <= 0.10) return { label: 'Light', ceiling: 0.10 };
  if (maxIntensity <= 0.30) return { label: 'Moderate', ceiling: 0.30 };
  if (maxIntensity <= 0.50) return { label: 'Heavy', ceiling: 0.50 };
  return { label: 'Extreme', ceiling: Math.max(maxIntensity * 1.2, 1.0) };
}

export default function MinutelyPrecipChart({ minutely }: Props) {
  if (!minutely || minutely.length < 5) return null;

  // Check if there's any precip to show
  const hasAnyPrecip = minutely.some(m => m.precipIntensity > 0.005 || m.precipProbability > 0.15);
  if (!hasAnyPrecip) return null;

  // Smooth intensities (matches iOS: radius 4, sigma 1.8)
  const rawIntensities = minutely.map(m => m.precipIntensity);
  const smoothed = gaussianSmooth(rawIntensities, 1.8);

  const maxIntensity = Math.max(...smoothed);
  const { label: intensityLbl, ceiling } = intensityLabel(maxIntensity);

  // Dominant precip type
  const typeCounts: Record<string, number> = {};
  minutely.filter(m => m.precipIntensity > 0.01).forEach(m => {
    typeCounts[m.precipType] = (typeCounts[m.precipType] || 0) + 1;
  });
  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'rain';
  const color = precipTypeColor(dominantType);

  const data = minutely.map((m, i) => {
    const date = new Date(m.time);
    const minsFromNow = Math.round((date.getTime() - new Date(minutely[0].time).getTime()) / 60000);
    let label = '';
    if (minsFromNow === 0) label = 'Now';
    else if (minsFromNow === 30) label = '30m';
    else if (minsFromNow === 60) label = '1h';
    else if (minsFromNow === 90) label = '90m';
    else if (minsFromNow === 120) label = '2h';

    return {
      index: i,
      label,
      intensity: smoothed[i],
      rawIntensity: m.precipIntensity,
      probability: m.precipProbability,
      type: m.precipType,
    };
  });

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-2">
        <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-wider">
          <span>⏱️</span>
          <span>Next 2 Hours</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-white/50">{intensityLbl}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
            <defs>
              <linearGradient id="minutelyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
              interval={0}
            />
            <YAxis hide domain={[0, ceiling]} />

            <Area
              type="natural"
              dataKey="intensity"
              stroke={color}
              strokeWidth={2}
              fill="url(#minutelyGrad)"
              animationDuration={600}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
