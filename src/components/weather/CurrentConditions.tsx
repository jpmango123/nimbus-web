'use client';

import { CurrentWeather, WeatherCondition, CONDITION_META, MinutelyForecast } from '@/lib/weather/types';
import { tempToColor } from '@/components/ui/TemperatureColor';
import WeatherIcon from '@/components/ui/WeatherIcon';
import { minutelyPrecipSummary, formatTemp } from '@/lib/weather/types';

interface Props {
  current: CurrentWeather;
  minutely?: MinutelyForecast[] | null;
  unit?: 'F' | 'C';
}

export default function CurrentConditions({ current, minutely, unit = 'F' }: Props) {
  const meta = CONDITION_META[current.condition];
  const precipSummary = minutely?.length ? minutelyPrecipSummary(minutely, current.temperature) : null;

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-6">
      {/* Main temp + condition */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div
            className="text-6xl font-light tabular-nums"
            style={{ color: tempToColor(current.temperature) }}
          >
            {formatTemp(current.temperature, unit)}
          </div>
          <div className="text-lg text-white/80 mt-1">{meta.displayName}</div>
          <div className="text-sm text-white/50">
            Feels like {formatTemp(current.feelsLike, unit)}
          </div>
        </div>
        <WeatherIcon condition={current.condition} size={64} />
      </div>

      {/* Minutely precip summary */}
      {precipSummary && precipSummary !== 'No precipitation expected' && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-200 text-sm">
          💧 {precipSummary}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 text-center">
        <StatItem label="Humidity" value={`${Math.round(current.humidity * 100)}%`} />
        <StatItem label="Wind" value={`${Math.round(current.windSpeed)} mph`} />
        <StatItem label="UV Index" value={current.uvIndex != null ? String(Math.round(current.uvIndex)) : '—'} />
        <StatItem label="Pressure" value={current.pressure ? `${current.pressure.toFixed(0)} mb` : '—'} />
        <StatItem label="Dew Point" value={current.dewPoint != null ? formatTemp(current.dewPoint, unit) : '—'} />
        <StatItem label="Visibility" value={current.visibility != null ? `${current.visibility.toFixed(0)} mi` : '—'} />
        <StatItem label="Cloud Cover" value={current.cloudCover != null ? `${Math.round(current.cloudCover * 100)}%` : '—'} />
        <StatItem
          label="Wind Gust"
          value={current.windGust != null ? `${Math.round(current.windGust)} mph` : '—'}
        />
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">{label}</div>
      <div className="text-sm font-medium text-white/80 tabular-nums">{value}</div>
    </div>
  );
}
