'use client';

// =============================================================================
// Large Widget Simulator — Matches iOS LargeWidgetView
// 329x345pt
// =============================================================================

import {
  ComposedChart, Area, Line, XAxis, YAxis, ResponsiveContainer,
} from 'recharts';
import {
  WeatherData, CONDITION_META, formatTemp, gaussianSmooth,
  MinutelyForecast,
} from '@/lib/weather/types';
import { tempToColor, precipTypeColor } from '@/components/ui/TemperatureColor';
import { minutelyPrecipSummary } from '@/lib/weather/types';

interface Props {
  weather: WeatherData;
  unit?: 'F' | 'C';
}

export default function LargeWidget({ weather, unit = 'F' }: Props) {
  const { current, daily, hourly, minutely, location, weatherAlerts } = weather;
  const meta = CONDITION_META[current.condition];
  const days = daily.slice(0, 7);
  const todayHigh = daily[0]?.temperatureHigh;
  const todayLow = daily[0]?.temperatureLow;

  const precipSummary = minutely?.length
    ? minutelyPrecipSummary(minutely, current.temperature)
    : null;

  // Check imminent precipitation
  const hasImminentPrecip = minutely?.some(
    m => m.precipProbability >= 0.15 || m.precipIntensity >= 0.01
  ) ?? false;

  const tempConvert = (f: number) => unit === 'C' ? (f - 32) * 5 / 9 : f;

  // Daily chart data (same as medium widget)
  const dailyChartData = days.map((d, i) => {
    const date = new Date(d.time);
    const isToday = new Date().toDateString() === date.toDateString();
    return {
      label: isToday ? 'Tod' : date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2),
      high: tempConvert(d.temperatureHigh),
      low: tempConvert(d.temperatureLow),
      precipProb: d.precipProbability,
      conditionDay: d.conditionDay,
    };
  });

  const allTemps = dailyChartData.flatMap(d => [d.high, d.low]);
  const minT = Math.min(...allTemps);
  const maxT = Math.max(...allTemps);
  const spread = Math.max(maxT - minT, 30);
  const yMin = minT - spread * 0.4;
  const yMax = maxT + spread * 0.15;
  const precipToY = (prob: number) => yMin + prob * (yMax - yMin) * 0.22;

  const rawPrecip = dailyChartData.map(d => d.precipProb);
  const smoothed = gaussianSmooth(rawPrecip, 1.5);
  const finalDailyData = dailyChartData.map((d, i) => ({
    ...d,
    smoothPrecip: precipToY(smoothed[i]),
  }));

  // Hourly chart data (12 hours)
  const hours = hourly.slice(0, 12);
  const hourlyData = hours.map((h, i) => {
    const date = new Date(h.time);
    return {
      label: i === 0 ? 'Now' : i % 2 === 0 ? date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }) : '',
      temp: tempConvert(h.temperature),
      precipProb: h.precipProbability,
    };
  });

  return (
    <div
      className="rounded-[22px] p-3 flex flex-col gap-2 overflow-hidden"
      style={{
        width: 329,
        height: 345,
        background: 'linear-gradient(135deg, #1a2744 0%, #0f1a2e 100%)',
      }}
    >
      {/* Header: current conditions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <div className="text-[10px] text-white/60 font-medium">{location.name.split(',')[0]}</div>
            <div className="text-xl font-light text-white tabular-nums leading-tight">
              {formatTemp(current.temperature, unit)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-white/40">{meta.displayName}</div>
          {todayHigh != null && todayLow != null && (
            <div className="text-[9px] text-white/40 tabular-nums">
              H:{formatTemp(todayHigh, unit)} L:{formatTemp(todayLow, unit)}
            </div>
          )}
        </div>
      </div>

      {/* Alerts */}
      {weatherAlerts.length > 0 && (
        <div className="px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-[9px] text-red-300 truncate">
          ⚠️ {weatherAlerts[0].event}
        </div>
      )}

      {/* Minutely precip or hourly chart */}
      <div className="flex-1 min-h-0">
        {hasImminentPrecip && minutely ? (
          <div>
            <div className="text-[9px] text-white/40 mb-1">
              {precipSummary}
            </div>
            <div className="h-[60px]">
              <MinutelyMiniChart minutely={minutely.slice(0, 60)} />
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[9px] text-white/40 mb-1">Next 12 Hours</div>
            <div className="h-[60px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={hourlyData} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                  <XAxis hide />
                  <YAxis hide />
                  <Line type="natural" dataKey="temp" stroke="#FF8A6E" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between px-1">
              {hourlyData.map((d, i) => (
                <span key={i} className="text-[7px] text-white/20">{d.label}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Daily chart */}
      <div>
        <div className="text-[9px] text-white/40 mb-1">7-Day Forecast</div>
        <div className="flex justify-between px-1 mb-0.5">
          {finalDailyData.map((d, i) => (
            <span key={i} className="text-[9px]">{CONDITION_META[d.conditionDay]?.icon || '❓'}</span>
          ))}
        </div>
        <div className="h-[60px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={finalDailyData} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="lwPrecipGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis hide />
              <YAxis hide domain={[yMin, yMax]} />
              <Area type="monotone" dataKey="smoothPrecip" stroke="none" fill="url(#lwPrecipGrad)" baseValue={yMin} />
              <Line type="natural" dataKey="high" stroke="#FF8A6E" strokeWidth={1.5} dot={false} />
              <Line type="natural" dataKey="low" stroke="#8BA3D4" strokeWidth={1.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-between px-1">
          {finalDailyData.map((d, i) => (
            <span key={i} className="text-[8px] text-white/30">{d.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Mini minutely chart for large widget
function MinutelyMiniChart({ minutely }: { minutely: MinutelyForecast[] }) {
  const data = minutely.map((m, i) => ({
    index: i,
    intensity: m.precipIntensity,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id="miniMinutelyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis hide />
        <YAxis hide />
        <Area type="natural" dataKey="intensity" stroke="#3B82F6" strokeWidth={1} fill="url(#miniMinutelyGrad)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
