'use client';

// =============================================================================
// 7-Day Daily Weather Chart — Hourly-Resolution Precipitation
// Uses actual hourly PoP data where available + bell-curve synthesis for distant days.
// Shared logic with iOS DailyWeatherChart and widget WidgetSparklineChart.
// =============================================================================

import { useState, useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { DailyForecast, HourlyForecast, gaussianSmooth } from '@/lib/weather/types';
import { tempToColor } from '@/components/ui/TemperatureColor';
import WeatherIcon from '@/components/ui/WeatherIcon';

interface Props {
  forecasts: DailyForecast[];
  hourlyForecasts?: HourlyForecast[];
  unit?: 'F' | 'C';
}

// =============================================================================
// Shared Precipitation Timeline Builder
// Produces hourly-resolution PoP data for smooth, accurate curves.
// Same algorithm used in iOS DailyWeatherChart.buildPrecipTimeline().
// =============================================================================

interface PrecipPoint {
  fractionalDay: number;   // 0.0 = midnight day 0, 0.5 = noon day 0, 1.0 = midnight day 1
  prob: number;            // 0.0–1.0 precipitation probability
}

export function buildPrecipTimeline(
  days: DailyForecast[],
  hourly: HourlyForecast[],
): PrecipPoint[] {
  if (days.length < 2) return [];

  // Compute day boundaries in milliseconds
  const dayStarts = days.map(d => {
    const dt = new Date(d.time);
    dt.setHours(0, 0, 0, 0);
    return dt.getTime();
  });
  const firstDayStart = dayStarts[0];
  const msPerDay = 86400000;
  const toFrac = (ms: number) => (ms - firstDayStart) / msPerDay;
  const lastFrac = days.length; // hard cutoff

  const points: PrecipPoint[] = [];
  const hourlyEndMs = hourly.length > 0 ? new Date(hourly[hourly.length - 1].time).getTime() : 0;

  // --- Step 1: Add actual hourly data ---
  for (const h of hourly) {
    const t = new Date(h.time).getTime();
    const frac = toFrac(t);
    if (frac >= -0.5 && frac < lastFrac) {
      points.push({ fractionalDay: frac, prob: h.precipProbability });
    }
  }

  // --- Step 2: Synthesize bell-curve points for days beyond hourly range ---
  // Long-range models (GFS/NBM) only provide daily aggregates or flat hourly values.
  // We create 24 synthetic hourly points per day with a Gaussian bell envelope
  // (peak at noon, ~0 at midnight) so the curve has natural day/night variation.
  for (let di = 0; di < days.length; di++) {
    const dayStart = dayStarts[di];
    if (dayStart + msPerDay <= hourlyEndMs) continue; // hourly data covers this day
    const dayProb = days[di].precipProbability;
    for (let h = 0; h < 24; h++) {
      const t = dayStart + h * 3600000;
      if (t <= hourlyEndMs) continue;
      const frac = toFrac(t);
      if (frac >= lastFrac) continue;
      const x = h - 12; // hours from noon
      const envelope = Math.exp(-x * x / 98); // Gaussian, sigma ≈ 5h
      points.push({ fractionalDay: frac, prob: dayProb * envelope });
    }
  }

  // --- Step 3: Reshape flat hourly data for distant days (>48h out) ---
  // GFS/NBM often report identical precipProbability for every hour of a day,
  // producing boxy flat-top curves. Detect these and apply bell-curve envelope.
  const nowMs = Date.now();
  for (let di = 0; di < days.length; di++) {
    const dayStart = dayStarts[di];
    if (dayStart - nowMs < 48 * 3600000) continue;  // near-term data is fine
    if (dayStart + msPerDay > hourlyEndMs) continue; // already synthesized above

    // Collect all points in this day
    const dayPts = points.filter(p => p.fractionalDay >= di && p.fractionalDay < di + 1);
    if (dayPts.length < 6) continue;

    const maxP = Math.max(...dayPts.map(p => p.prob));
    const minP = Math.min(...dayPts.map(p => p.prob));
    if (maxP < 0.01) continue;

    // If hourly variance is < 40% of peak, data is effectively flat → reshape
    if ((maxP - minP) < maxP * 0.4) {
      for (const pt of points) {
        if (pt.fractionalDay >= di && pt.fractionalDay < di + 1) {
          const hourOfDay = (pt.fractionalDay - di) * 24;
          const x = hourOfDay - 12;
          pt.prob *= Math.exp(-x * x / 98);
        }
      }
    }
  }

  // --- Step 4: Supplement — ensure daily precipProbability is represented ---
  // Hourly probabilities are often much lower than daily aggregates because daily
  // probability = "chance of rain at any point during the day" while hourly = per-hour chance.
  // If max hourly prob for a day is < daily prob, inject dome-shaped supplement points
  // so the chart height matches the daily probability users see in the forecast.
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    if (day.precipProbability < 0.10 || day.precipAccumulation < 0.005) continue;

    const dayPts = points.filter(p => p.fractionalDay >= di && p.fractionalDay < di + 1);
    const maxHourly = dayPts.length > 0 ? Math.max(...dayPts.map(p => p.prob)) : 0;

    if (maxHourly < day.precipProbability * 0.6) {
      // Inject supplement dome: 9am, noon, 3pm at daily probability
      for (const hourOffset of [9 / 24, 12 / 24, 15 / 24]) {
        const frac = di + hourOffset;
        const scale = hourOffset === 0.5 ? 1.0 : 0.7; // peak at noon
        points.push({ fractionalDay: frac, prob: day.precipProbability * scale });
      }
    }
  }

  // --- Step 5.5: Ensure smooth edge tapers ---
  // If the first or last points have precipitation, add gradual taper points
  // instead of letting the chart create sharp vertical edges.
  // (The chart's baseValue handles the bottom; we just need smooth Y transitions.)

  // --- Step 6: Sort and apply Gaussian smoothing ---
  points.sort((a, b) => a.fractionalDay - b.fractionalDay);
  const smoothed = gaussianSmooth(points.map(p => p.prob), 2.0);
  return points.map((p, i) => ({ fractionalDay: p.fractionalDay, prob: smoothed[i] }));
}

// =============================================================================
// Chart Component
// =============================================================================

// Unified data point: has precip at every position, temp only at day positions
interface ChartEntry {
  x: number;           // fractional day index
  precipY: number;     // precip mapped to temp Y scale
  high?: number;       // only set at day positions
  low?: number;        // only set at day positions
  dayIndex?: number;   // which day this corresponds to
}

export default function DailyWeatherChart({ forecasts, hourlyForecasts, unit = 'F' }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const days = forecasts.slice(0, 7);

  if (days.length < 2) return null;

  const tempConvert = (f: number) => unit === 'C' ? (f - 32) * 5 / 9 : f;

  // Day labels
  const dayLabels = useMemo(() => days.map(day => {
    const date = new Date(day.time);
    const isToday = new Date().toDateString() === date.toDateString();
    return isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
  }), [days]);

  // Chart Y range — matches iOS: 18° below min, 22° above max, min 45° spread
  const allTemps = days.flatMap(d => [tempConvert(d.temperatureHigh), tempConvert(d.temperatureLow)]);
  const minTemp = Math.min(...allTemps);
  const maxTemp = Math.max(...allTemps);
  const spread = Math.max(maxTemp - minTemp, 45);
  const yMin = minTemp - 18;
  const yMax = yMin + spread + 22;

  // Precip occupies bottom 30% of chart for better visibility
  const precipFrac = 0.30;
  const precipToY = (prob: number) => yMin + Math.min(prob, 1.0) * (yMax - yMin) * precipFrac;

  // Build hourly precip timeline
  const precipTimeline = useMemo(
    () => buildPrecipTimeline(days, hourlyForecasts || []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(days.map(d => d.precipProbability.toFixed(2))), hourlyForecasts?.length],
  );

  // Build unified chart data array
  const chartData = useMemo(() => {
    const entries: ChartEntry[] = [];

    // Sample precip timeline to ~80 points max (smooth enough, not too heavy for Recharts)
    const step = Math.max(1, Math.floor(precipTimeline.length / 80));
    for (let i = 0; i < precipTimeline.length; i += step) {
      const pt = precipTimeline[i];
      const dayIdx = Math.min(Math.max(Math.floor(pt.fractionalDay), 0), days.length - 1);
      const day = days[dayIdx];
      const isNoise = day.precipProbability < 0.15 && day.precipAccumulation < 0.01;
      entries.push({
        x: pt.fractionalDay,
        precipY: isNoise ? yMin : precipToY(pt.prob),
      });
    }
    // Always include last point
    if (precipTimeline.length > 0) {
      const last = precipTimeline[precipTimeline.length - 1];
      const dayIdx = Math.min(Math.max(Math.floor(last.fractionalDay), 0), days.length - 1);
      const day = days[dayIdx];
      const isNoise = day.precipProbability < 0.15 && day.precipAccumulation < 0.01;
      entries.push({
        x: last.fractionalDay,
        precipY: isNoise ? yMin : precipToY(last.prob),
      });
    }

    // Insert temp data at exact day positions (x = 0, 1, 2, ... 6)
    for (let i = 0; i < days.length; i++) {
      // Find if there's already an entry close to this position
      const existing = entries.find(e => Math.abs(e.x - i) < 0.02);
      if (existing) {
        existing.high = tempConvert(days[i].temperatureHigh);
        existing.low = tempConvert(days[i].temperatureLow);
        existing.dayIndex = i;
        existing.x = i; // snap to exact integer
      } else {
        const dayIdx = i;
        const day = days[dayIdx];
        const isNoise = day.precipProbability < 0.15 && day.precipAccumulation < 0.01;
        const closestPrecip = precipTimeline.reduce((best, pt) =>
          Math.abs(pt.fractionalDay - i) < Math.abs(best.fractionalDay - i) ? pt : best,
          precipTimeline[0] || { fractionalDay: i, prob: 0 },
        );
        entries.push({
          x: i,
          precipY: isNoise ? yMin : precipToY(closestPrecip.prob),
          high: tempConvert(days[i].temperatureHigh),
          low: tempConvert(days[i].temperatureLow),
          dayIndex: i,
        });
      }
    }

    // Sort by x position
    entries.sort((a, b) => a.x - b.x);
    return entries;
  }, [precipTimeline, days, yMin, yMax, precipFrac, tempConvert]);

  const selected = selectedIdx != null ? days[selectedIdx] : null;
  const dayTicks = days.map((_, i) => i);

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4">
      <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-wider mb-3 px-2">
        <span>📅</span>
        <span>7-Day Forecast</span>
      </div>

      <div className="flex justify-between px-6 mb-1">
        {days.map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <WeatherIcon condition={d.conditionDay} size={18} />
            <WeatherIcon condition={d.conditionNight} size={12} />
          </div>
        ))}
      </div>

      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 15, left: 15, bottom: 0 }}
            onClick={(e) => {
              const di = e?.activePayload?.[0]?.payload?.dayIndex;
              if (di != null) setSelectedIdx(di);
            }}
          >
            <defs>
              <linearGradient id="precipAreaGrad7d" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.1} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />

            <XAxis
              dataKey="x"
              type="number"
              domain={[-0.5, days.length - 0.5]}
              ticks={dayTicks}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val: number) => dayLabels[Math.round(val)] || ''}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
            />
            <YAxis hide domain={[yMin, yMax]} />

            {/* Precipitation area — hourly resolution, smooth natural curve */}
            <Area
              type="natural"
              dataKey="precipY"
              stroke="#3B82F6"
              strokeWidth={1.5}
              strokeOpacity={0.6}
              fill="url(#precipAreaGrad7d)"
              baseValue={yMin}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
            />

            {/* High temp line — connects only at day positions via connectNulls */}
            <Line
              type="natural"
              dataKey="high"
              stroke="#FF8A6E"
              strokeWidth={2.5}
              strokeLinecap="round"
              connectNulls
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartEntry };
                if (payload.high == null) return <g key={`he-${cx}-${cy}`} />;
                return (
                  <circle
                    key={`h-${payload.dayIndex}`}
                    cx={cx} cy={cy} r={3.5}
                    fill={tempToColor(unit === 'C' ? payload.high * 9 / 5 + 32 : payload.high)}
                    stroke="rgba(0,0,0,0.2)" strokeWidth={1}
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
              connectNulls
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartEntry };
                if (payload.low == null) return <g key={`le-${cx}-${cy}`} />;
                return (
                  <circle
                    key={`l-${payload.dayIndex}`}
                    cx={cx} cy={cy} r={3}
                    fill={tempToColor(unit === 'C' ? payload.low * 9 / 5 + 32 : payload.low)}
                    stroke="rgba(0,0,0,0.2)" strokeWidth={1}
                  />
                );
              }}
              animationDuration={600}
            />

            {selectedIdx != null && (
              <ReferenceLine x={selectedIdx} stroke="rgba(255,255,255,0.2)" strokeDasharray="5 3" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-between px-6 mt-1">
        {days.map((d, i) => (
          <div key={i} className="flex flex-col items-center text-xs tabular-nums">
            <span style={{ color: tempToColor(unit === 'C' ? tempConvert(d.temperatureHigh) * 9 / 5 + 32 : tempConvert(d.temperatureHigh)) }} className="font-semibold">
              {Math.round(tempConvert(d.temperatureHigh))}°
            </span>
            <span style={{ color: tempToColor(unit === 'C' ? tempConvert(d.temperatureLow) * 9 / 5 + 32 : tempConvert(d.temperatureLow)) }} className="opacity-70">
              {Math.round(tempConvert(d.temperatureLow))}°
            </span>
          </div>
        ))}
      </div>

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
