'use client';

// =============================================================================
// Small Widget Simulator — Matches iOS SmallWidgetView
// 155x155pt (310x310 @2x)
// =============================================================================

import { WeatherData, CONDITION_META, formatTemp } from '@/lib/weather/types';
import { minutelyPrecipSummary } from '@/lib/weather/types';

interface Props {
  weather: WeatherData;
  unit?: 'F' | 'C';
}

export default function SmallWidget({ weather, unit = 'F' }: Props) {
  const { current, minutely, daily, location } = weather;
  const meta = CONDITION_META[current.condition];
  const precipSummary = minutely?.length
    ? minutelyPrecipSummary(minutely, current.temperature)
    : null;
  const showPrecip = precipSummary && precipSummary !== 'No precipitation expected';
  const todayHigh = daily[0]?.temperatureHigh;
  const todayLow = daily[0]?.temperatureLow;

  return (
    <div
      className="rounded-[22px] p-3 flex flex-col justify-between overflow-hidden"
      style={{
        width: 155,
        height: 155,
        background: 'linear-gradient(135deg, #1a2744 0%, #0f1a2e 100%)',
      }}
    >
      {/* Top: location + staleness */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-white/60 font-medium truncate max-w-[100px]">
          {location.name.split(',')[0]}
        </span>
      </div>

      {/* Middle: icon + temp */}
      <div className="flex items-center gap-2">
        <span className="text-3xl">{meta.icon}</span>
        <span className="text-3xl font-light text-white tabular-nums">
          {formatTemp(current.temperature, unit)}
        </span>
      </div>

      {/* Bottom: precip or condition + H/L */}
      <div>
        {showPrecip ? (
          <div className="text-[10px] text-blue-300 mb-1 truncate">
            💧 {precipSummary}
          </div>
        ) : (
          <div className="text-[10px] text-white/50 mb-1">{meta.displayName}</div>
        )}
        {todayHigh != null && todayLow != null && (
          <div className="text-[10px] text-white/40 tabular-nums">
            H:{formatTemp(todayHigh, unit)} L:{formatTemp(todayLow, unit)}
          </div>
        )}
      </div>
    </div>
  );
}
