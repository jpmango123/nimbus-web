'use client';

// =============================================================================
// Medium Widget Simulator — Matches iOS MediumWidgetView
// 329x155pt
// =============================================================================

import {
  ComposedChart, Area, Line, XAxis, YAxis, ResponsiveContainer,
} from 'recharts';
import { WeatherData, CONDITION_META, formatTemp, gaussianSmooth } from '@/lib/weather/types';
import { tempToColor } from '@/components/ui/TemperatureColor';
import { minutelyPrecipSummary } from '@/lib/weather/types';

interface Props {
  weather: WeatherData;
  unit?: 'F' | 'C';
}

export default function MediumWidget({ weather, unit = 'F' }: Props) {
  const { current, daily, minutely, location } = weather;
  const meta = CONDITION_META[current.condition];
  const days = daily.slice(0, 7);
  const precipSummary = minutely?.length
    ? minutelyPrecipSummary(minutely, current.temperature)
    : null;
  const showPrecip = precipSummary && precipSummary !== 'No precipitation expected';

  const todayHigh = daily[0]?.temperatureHigh;
  const todayLow = daily[0]?.temperatureLow;

  const tempConvert = (f: number) => unit === 'C' ? (f - 32) * 5 / 9 : f;

  // Chart data
  const chartData = days.map((d, i) => {
    const date = new Date(d.time);
    const isToday = new Date().toDateString() === date.toDateString();
    return {
      label: isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0),
      high: tempConvert(d.temperatureHigh),
      low: tempConvert(d.temperatureLow),
      precipProb: d.precipProbability,
      conditionDay: d.conditionDay,
    };
  });

  const allTemps = chartData.flatMap(d => [d.high, d.low]);
  const minT = Math.min(...allTemps);
  const maxT = Math.max(...allTemps);
  const spread = Math.max(maxT - minT, 30);
  const yMin = minT - spread * 0.4;
  const yMax = maxT + spread * 0.15;

  const precipToY = (prob: number) => yMin + prob * (yMax - yMin) * 0.22;
  const rawPrecip = chartData.map(d => d.precipProb);
  const smoothed = gaussianSmooth(rawPrecip, 1.5);
  const finalData = chartData.map((d, i) => ({
    ...d,
    smoothPrecip: precipToY(smoothed[i]),
  }));

  return (
    <div
      className="rounded-[22px] p-3 flex gap-3 overflow-hidden"
      style={{
        width: 329,
        height: 155,
        background: 'linear-gradient(135deg, #1a2744 0%, #0f1a2e 100%)',
      }}
    >
      {/* Left: current conditions */}
      <div className="flex flex-col justify-between w-[100px] flex-shrink-0">
        <div>
          <div className="text-[10px] text-white/60 font-medium truncate">
            {location.name.split(',')[0]}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-lg">{meta.icon}</span>
            <span className="text-2xl font-light text-white tabular-nums">
              {formatTemp(current.temperature, unit)}
            </span>
          </div>
          <div className="text-[9px] text-white/40">{meta.displayName}</div>
        </div>
        <div>
          {showPrecip && (
            <div className="text-[9px] text-blue-300 mb-0.5 leading-tight">
              💧 {precipSummary}
            </div>
          )}
          {todayHigh != null && todayLow != null && (
            <div className="text-[9px] text-white/40 tabular-nums">
              H:{formatTemp(todayHigh, unit)} L:{formatTemp(todayLow, unit)}
            </div>
          )}
        </div>
      </div>

      {/* Right: 7-day chart */}
      <div className="flex-1 flex flex-col">
        {/* Condition icons */}
        <div className="flex justify-between px-1 mb-0.5">
          {finalData.map((d, i) => (
            <span key={i} className="text-[10px]">{CONDITION_META[d.conditionDay]?.icon || '❓'}</span>
          ))}
        </div>

        {/* Chart */}
        <div className="flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={finalData} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="mwPrecipGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis hide />
              <YAxis hide domain={[yMin, yMax]} />
              <Area
                type="monotone"
                dataKey="smoothPrecip"
                stroke="none"
                fill="url(#mwPrecipGrad)"
                baseValue={yMin}
              />
              <Line type="natural" dataKey="high" stroke="#FF8A6E" strokeWidth={1.5} dot={false} />
              <Line type="natural" dataKey="low" stroke="#8BA3D4" strokeWidth={1.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Day labels */}
        <div className="flex justify-between px-1">
          {finalData.map((d, i) => (
            <span key={i} className="text-[8px] text-white/30">{d.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
