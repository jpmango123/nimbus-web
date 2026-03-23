'use client';

// =============================================================================
// Weather Page — Full display for a single location
// Matches iOS WeatherPageView layout
// =============================================================================

import { WeatherData } from '@/lib/weather/types';
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

      {/* Minutely precipitation (next 2 hours) */}
      {weather.minutely && weather.minutely.length > 0 && (
        <MinutelyPrecipChart minutely={weather.minutely} />
      )}

      {/* Hourly forecast (48h scrollable chart) */}
      <HourlyForecastCard hourly={weather.hourly} unit={unit} />

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
