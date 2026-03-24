'use client';

// =============================================================================
// Weather Page — Full display for a single location
// Matches iOS WeatherPageView layout
// =============================================================================

import { WeatherData, formatPrecipAccum } from '@/lib/weather/types';
import CurrentConditions from './CurrentConditions';
import MinutelyPrecipChart from './MinutelyPrecipChart';
import HourlyForecastCard from './HourlyForecastCard';
import DailyWeatherChart from './DailyWeatherChart';
import PrecipitationGraph from './PrecipitationGraph';
import AlertBanner from './AlertBanner';
import StormBanner from './StormBanner';
import TideCard from './TideCard';

interface Props {
  weather: WeatherData;
  unit?: 'F' | 'C';
}

export default function WeatherPage({ weather, unit = 'F' }: Props) {
  // Calculate precipitation accumulation today from hourly data
  const todayAccum = (() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let predicted = 0;
    let actual = weather.past24hPrecipitation ?? 0;
    for (const h of weather.hourly) {
      const t = new Date(h.time);
      if (t >= todayStart && t <= now) {
        predicted += h.precipAccumulation;
      }
    }
    return { predicted, actual };
  })();

  const hasTodayPrecip = todayAccum.predicted > 0.005 || todayAccum.actual > 0.005;

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Location header */}
      <div className="text-center pt-2">
        <h2 className="text-xl font-semibold text-white">{weather.location.name}</h2>
        <div className="text-xs text-white/40 mt-1">
          via {weather.provider}
          {weather.providerNote && ` · ${weather.providerNote}`}
          {' · '}Updated {new Date(weather.fetchedAt).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true,
          })}
        </div>
      </div>

      {/* Weather alerts */}
      <AlertBanner alerts={weather.weatherAlerts} />

      {/* Storm events */}
      <StormBanner storms={weather.stormEvents} />

      {/* Current conditions */}
      <CurrentConditions
        current={weather.current}
        minutely={weather.minutely}
        unit={unit}
      />

      {/* Precipitation accumulation tracker */}
      {hasTodayPrecip && (
        <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-wider">
              <span>🌧️</span>
              <span>Precipitation Today</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              {todayAccum.actual > 0.005 && (
                <div className="text-right">
                  <div className="text-white/40">Past 24h</div>
                  <div className="text-blue-300 font-medium">{formatPrecipAccum(todayAccum.actual)}</div>
                </div>
              )}
              <div className="text-right">
                <div className="text-white/40">Forecast Today</div>
                <div className="text-cyan-300 font-medium">{formatPrecipAccum(todayAccum.predicted)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Minutely precipitation (next 2 hours) */}
      {weather.minutely && weather.minutely.length > 0 && (
        <MinutelyPrecipChart minutely={weather.minutely} />
      )}

      {/* Hourly forecast (48h scrollable chart) with night shading + storm markers */}
      <HourlyForecastCard
        hourly={weather.hourly}
        storms={weather.stormEvents}
        unit={unit}
      />

      {/* Daily weather chart (7-day) */}
      <DailyWeatherChart
        forecasts={weather.daily}
        hourlyForecasts={weather.hourly}
        unit={unit}
      />

      {/* Precipitation probability (10-day) */}
      <PrecipitationGraph forecasts={weather.daily} />

      {/* Tide card (if coastal) */}
      {weather.tideData && <TideCard tideData={weather.tideData} />}
    </div>
  );
}
