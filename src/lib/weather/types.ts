// =============================================================================
// Nimbus Web — Weather Data Types
// Ported from iOS Swift models to match 1:1
// =============================================================================

// MARK: - Weather Condition

export type WeatherCondition =
  | 'clear-day'
  | 'clear-night'
  | 'rain'
  | 'snow'
  | 'sleet'
  | 'wind'
  | 'fog'
  | 'cloudy'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'hail'
  | 'thunderstorm'
  | 'tornado'
  | 'sunrise'
  | 'sunset'
  | 'unknown';

export type PrecipitationType = 'rain' | 'snow' | 'sleet' | 'none';

export type WeatherProvider =
  | 'Open-Meteo'
  | 'NWS'
  | 'Blended'
  | 'Mock Data';

export type AlertSeverity = 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
export type StormSeverity = 'minor' | 'moderate' | 'significant' | 'severe';

// MARK: - Condition Metadata

export const CONDITION_META: Record<WeatherCondition, {
  icon: string;       // emoji icon for web
  displayName: string;
  color: string;      // CSS color
  isPrecipitation: boolean;
  inferredPrecipType: PrecipitationType;
}> = {
  'clear-day':           { icon: '☀️', displayName: 'Clear',         color: '#FBBF24', isPrecipitation: false, inferredPrecipType: 'rain' },
  'clear-night':         { icon: '🌙', displayName: 'Clear',         color: '#6366F1', isPrecipitation: false, inferredPrecipType: 'rain' },
  'rain':                { icon: '🌧️', displayName: 'Rain',          color: '#3B82F6', isPrecipitation: true,  inferredPrecipType: 'rain' },
  'snow':                { icon: '🌨️', displayName: 'Snow',          color: '#06B6D4', isPrecipitation: true,  inferredPrecipType: 'snow' },
  'sleet':               { icon: '🌨️', displayName: 'Sleet',         color: '#14B8A6', isPrecipitation: true,  inferredPrecipType: 'sleet' },
  'wind':                { icon: '💨', displayName: 'Windy',         color: '#9CA3AF', isPrecipitation: false, inferredPrecipType: 'rain' },
  'fog':                 { icon: '🌫️', displayName: 'Fog',           color: '#9CA3AFB3', isPrecipitation: false, inferredPrecipType: 'rain' },
  'cloudy':              { icon: '☁️', displayName: 'Cloudy',        color: '#9CA3AF', isPrecipitation: false, inferredPrecipType: 'rain' },
  'partly-cloudy-day':   { icon: '⛅', displayName: 'Partly Cloudy', color: '#F97316', isPrecipitation: false, inferredPrecipType: 'rain' },
  'partly-cloudy-night': { icon: '☁️', displayName: 'Partly Cloudy', color: '#6366F1B3', isPrecipitation: false, inferredPrecipType: 'rain' },
  'hail':                { icon: '🌨️', displayName: 'Hail',          color: '#14B8A6', isPrecipitation: true,  inferredPrecipType: 'sleet' },
  'thunderstorm':        { icon: '⛈️', displayName: 'Thunderstorm',  color: '#A855F7', isPrecipitation: true,  inferredPrecipType: 'rain' },
  'tornado':             { icon: '🌪️', displayName: 'Tornado',       color: '#EF4444', isPrecipitation: false, inferredPrecipType: 'rain' },
  'sunrise':             { icon: '🌅', displayName: 'Sunrise',       color: '#F97316', isPrecipitation: false, inferredPrecipType: 'rain' },
  'sunset':              { icon: '🌇', displayName: 'Sunset',        color: '#F97316', isPrecipitation: false, inferredPrecipType: 'rain' },
  'unknown':             { icon: '❓', displayName: 'Unknown',       color: '#6B7280', isPrecipitation: false, inferredPrecipType: 'rain' },
};

export const PRECIP_TYPE_META: Record<PrecipitationType, {
  color: string;
  displayName: string;
  icon: string;
}> = {
  rain:  { color: '#3B82F6', displayName: 'Rain',  icon: '💧' },
  snow:  { color: '#E0F2FE', displayName: 'Snow',  icon: '❄️' },
  sleet: { color: '#A855F7', displayName: 'Sleet', icon: '🌨️' },
  none:  { color: '#3B82F6', displayName: '',       icon: '' },
};

export const ALERT_SEVERITY_META: Record<AlertSeverity, { color: string; icon: string }> = {
  extreme: { color: '#EF4444', icon: '⚠️' },
  severe:  { color: '#F97316', icon: '⚠️' },
  moderate:{ color: '#EAB308', icon: '⚡' },
  minor:   { color: '#3B82F6', icon: 'ℹ️' },
  unknown: { color: '#6B7280', icon: '❓' },
};

export const STORM_SEVERITY_META: Record<StormSeverity, { color: string; displayName: string }> = {
  minor:       { color: '#22C55E', displayName: 'Minor' },
  moderate:    { color: '#EAB308', displayName: 'Moderate' },
  significant: { color: '#F97316', displayName: 'Significant' },
  severe:      { color: '#EF4444', displayName: 'Severe' },
};

// MARK: - Core Data Structures

export interface LocationInfo {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface SavedLocation extends LocationInfo {
  id: number;
  sortOrder: number;
}

export interface CurrentWeather {
  temperature: number;       // °F
  feelsLike: number;
  humidity: number;          // 0.0–1.0
  windSpeed: number;         // mph
  windGust: number | null;
  windBearing: number | null;// degrees
  pressure: number | null;   // mb
  dewPoint: number | null;   // °F
  uvIndex: number | null;
  visibility: number | null; // miles
  cloudCover: number | null; // 0.0–1.0
  condition: WeatherCondition;
  summary: string;
  precipProbability: number; // 0.0–1.0
  precipIntensity: number | null; // inches/hr
}

export interface HourlyForecast {
  time: string;              // ISO 8601
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windGust: number | null;
  condition: WeatherCondition;
  precipProbability: number;
  precipIntensity: number;
  precipAccumulation: number;
  precipType: PrecipitationType;
  cloudCover: number | null;
  uvIndex: number | null;
  isDaylight: boolean;
  precipAmountLow?: number;
  precipAmountHigh?: number;
}

export interface DailyForecast {
  time: string;              // ISO 8601
  temperatureHigh: number;
  temperatureLow: number;
  temperatureHighTime: string | null;
  temperatureLowTime: string | null;
  feelsLikeHigh: number;
  feelsLikeLow: number;
  humidity: number;
  windSpeed: number;
  windGust: number | null;
  conditionDay: WeatherCondition;
  conditionNight: WeatherCondition;
  summary: string;
  precipProbability: number;
  precipAccumulation: number;
  precipType: PrecipitationType;
  snowAccumulation: number;
  cloudCover: number | null;
  uvIndex: number | null;
  dewPoint: number | null;
  sunrise: string | null;
  sunset: string | null;
  moonPhase: number | null;
}

export interface MinutelyForecast {
  time: string;              // ISO 8601
  precipIntensity: number;   // inches/hr
  precipProbability: number; // 0.0–1.0
  precipType: PrecipitationType;
}

export interface StormPhase {
  startTime: string;
  endTime: string;
  precipType: PrecipitationType;
  accumulation: number;
}

export interface StormEvent {
  id: string;
  startTime: string;
  endTime: string;
  phases: StormPhase[];
  dominantPrecipType: PrecipitationType;
  rainAccumulation: number;
  snowAccumulation: number;
  sleetAccumulation: number;
  totalAccumulation: number;
  peakIntensity: number;
  averageIntensity: number;
  averageProbability: number;
  severity: StormSeverity;
  peakWindSpeed: number | null;
  peakWindGust: number | null;
}

export interface WeatherAlert {
  id: string;
  event: string;
  headline: string | null;
  description: string;
  severity: AlertSeverity;
  urgency: string | null;
  sender: string | null;
  startTime: string | null;
  endTime: string | null;
  regions: string[];
}

export interface TideEntry {
  time: string;
  height: number;   // feet
  type: 'H' | 'L' | null; // High, Low, or interpolated
}

export interface TideData {
  station: string;
  entries: TideEntry[];
  highLow: TideEntry[];
}

export interface WeatherData {
  location: LocationInfo;
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  stormEvents: StormEvent[];
  weatherAlerts: WeatherAlert[];
  minutely: MinutelyForecast[] | null;
  past24hPrecipitation: number | null;
  past24hPrecipType: PrecipitationType | null;
  tideData: TideData | null;
  fetchedAt: string;         // ISO 8601
  provider: WeatherProvider;
  providerNote: string | null;
}

// MARK: - Utility Functions

/** Maps temperature (°F) to a CSS hsl() color string.
 *  Matches iOS: 32°F=Blue(0.60), 55°F=Green(0.33), 75°F=Yellow(0.15), 95°F=Red(0.00) */
export function temperatureToColor(tempF: number): string {
  let hue: number;
  if (tempF <= 32) {
    hue = 216; // 0.60 * 360
  } else if (tempF <= 55) {
    hue = 216 - (216 - 119) * ((tempF - 32) / (55 - 32));
  } else if (tempF <= 75) {
    hue = 119 - (119 - 54) * ((tempF - 55) / (75 - 55));
  } else if (tempF <= 95) {
    hue = 54 - 54 * ((tempF - 75) / (95 - 75));
  } else {
    hue = 0;
  }
  return `hsl(${Math.round(hue)}, 85%, 60%)`;
}

/** Precipitation summary from minutely data (matches iOS logic) */
export function minutelyPrecipSummary(
  minutely: MinutelyForecast[],
  temperature?: number
): string {
  if (!minutely.length) return 'No precipitation expected';

  const intensityThreshold = 0.02;
  const probThreshold = 0.15;
  const now = new Date(minutely[0].time).getTime();

  function isWet(m: MinutelyForecast): boolean {
    return m.precipIntensity >= intensityThreshold || m.precipProbability >= probThreshold;
  }

  function dominantType(entries: MinutelyForecast[]): string {
    const wet = entries.filter(e => e.precipIntensity >= 0.02);
    if (!wet.length) return 'Precipitation';
    const counts: Record<string, number> = {};
    for (const e of wet) {
      let type = e.precipType;
      if (temperature !== undefined && temperature <= 34 && type === 'rain') type = 'snow';
      counts[type] = (counts[type] || 0) + 1;
    }
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return dominant === 'none' ? 'Precipitation' : dominant.charAt(0).toUpperCase() + dominant.slice(1);
  }

  const isCurrentlyRaining = isWet(minutely[0]);

  if (isCurrentlyRaining) {
    const stopIdx = minutely.findIndex(m => !isWet(m));
    if (stopIdx >= 0) {
      const mins = Math.round((new Date(minutely[stopIdx].time).getTime() - now) / 60000);
      return `${dominantType(minutely.slice(0, stopIdx))} stopping in ${mins} min`;
    }
    return `${dominantType(minutely)} expected for the next 2 hours`;
  }

  const startIdx = minutely.findIndex(m => isWet(m));
  if (startIdx >= 0) {
    const minsUntil = Math.round((new Date(minutely[startIdx].time).getTime() - now) / 60000);
    const afterStart = minutely.slice(startIdx);
    const stopIdx = afterStart.findIndex(m => !isWet(m));
    if (stopIdx >= 0) {
      const duration = Math.round(
        (new Date(afterStart[stopIdx].time).getTime() - new Date(minutely[startIdx].time).getTime()) / 60000
      );
      return `${dominantType(afterStart.slice(0, stopIdx))} in ${minsUntil} min, lasting ${duration} min`;
    }
    return `${dominantType(afterStart)} starting in ${minsUntil} min`;
  }

  return 'No precipitation expected';
}

/** Gaussian smoothing (matches iOS Gaussian filter) */
export function gaussianSmooth(data: number[], sigma: number): number[] {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  return data.map((_, idx) => {
    let val = 0;
    for (let k = 0; k < kernel.length; k++) {
      const di = idx + k - radius;
      const clamped = Math.max(0, Math.min(data.length - 1, di));
      val += data[clamped] * kernel[k];
    }
    return val;
  });
}

/** Format temperature with optional unit conversion */
export function formatTemp(tempF: number, unit: 'F' | 'C' = 'F'): string {
  const value = unit === 'C' ? (tempF - 32) * 5 / 9 : tempF;
  return `${Math.round(value)}°`;
}

/** Format precipitation accumulation like iOS ("0.50" or "6.0") */
export function formatPrecipAccum(inches: number): string {
  if (inches >= 1) return `${inches.toFixed(1)}"`;
  return `${inches.toFixed(2)}"`;
}
