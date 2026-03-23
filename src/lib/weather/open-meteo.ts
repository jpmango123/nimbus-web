// =============================================================================
// Open-Meteo API Client — Free, no API key required
// Matches iOS BlendedWeatherProvider with HRRR/NBM/GFS weighted blending
// =============================================================================

import {
  WeatherData, CurrentWeather, HourlyForecast, DailyForecast,
  MinutelyForecast, LocationInfo, WeatherCondition, PrecipitationType,
} from './types';

// MARK: - Open-Meteo Response Types

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  relative_humidity_2m: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
  weather_code: number[];
  precipitation_probability: number[];
  precipitation: number[];
  snowfall: number[];
  cloud_cover: number[];
  uv_index: number[];
  is_day: number[];
  dew_point_2m?: number[];
  wind_direction_10m?: number[];
  surface_pressure?: number[];
  visibility?: number[];
}

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  apparent_temperature_max: number[];
  apparent_temperature_min: number[];
  precipitation_sum: number[];
  precipitation_probability_max: number[];
  snowfall_sum: number[];
  weather_code: number[];
  wind_speed_10m_max: number[];
  wind_gusts_10m_max: number[];
  uv_index_max: number[];
  sunrise: string[];
  sunset: string[];
}

interface OpenMeteoCurrent {
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  wind_gusts_10m: number;
  wind_direction_10m: number;
  weather_code: number;
  precipitation: number;
  cloud_cover: number;
  surface_pressure: number;
  is_day: number;
  uv_index?: number;
}

interface OpenMeteoMinutely15 {
  time: string[];
  precipitation: number[];
  precipitation_probability?: number[];
  snowfall?: number[];
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
  hourly?: OpenMeteoHourly;
  daily?: OpenMeteoDaily;
  minutely_15?: OpenMeteoMinutely15;
}

// MARK: - WMO Weather Code Mapping

function wmoToCondition(code: number, isDay: boolean): WeatherCondition {
  if (code === 0) return isDay ? 'clear-day' : 'clear-night';
  if (code === 1) return isDay ? 'clear-day' : 'clear-night';
  if (code === 2) return isDay ? 'partly-cloudy-day' : 'partly-cloudy-night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'rain'; // drizzle
  if (code >= 56 && code <= 57) return 'sleet'; // freezing drizzle
  if (code >= 61 && code <= 65) return 'rain';
  if (code >= 66 && code <= 67) return 'sleet'; // freezing rain
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain'; // rain showers
  if (code >= 85 && code <= 86) return 'snow'; // snow showers
  if (code === 95) return 'thunderstorm';
  if (code >= 96 && code <= 99) return 'thunderstorm'; // thunderstorm w/ hail
  return 'unknown';
}

function wmoPrecipType(code: number, temp: number): PrecipitationType {
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 56 && code <= 57) return 'sleet';
  if (code >= 66 && code <= 67) return 'sleet';
  if (code >= 51 && code <= 55) return 'rain';
  if (code >= 61 && code <= 65) return 'rain';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 95 && code <= 99) return 'rain';
  // Temperature fallback
  if (temp <= 32) return 'snow';
  if (temp <= 34) return 'sleet';
  return 'none';
}

// MARK: - Unit Conversion

function celsiusToF(c: number): number { return c * 9 / 5 + 32; }
function kmhToMph(kmh: number): number { return kmh * 0.621371; }
function mmToInches(mm: number): number { return mm * 0.0393701; }
function cmToInches(cm: number): number { return cm * 0.393701; }
function mToMiles(m: number): number { return m * 0.000621371; }

// MARK: - API URLs

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';

const HOURLY_PARAMS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'wind_speed_10m', 'wind_gusts_10m', 'weather_code',
  'precipitation_probability', 'precipitation', 'snowfall',
  'cloud_cover', 'uv_index', 'is_day', 'dew_point_2m',
  'wind_direction_10m', 'surface_pressure', 'visibility',
].join(',');

const DAILY_PARAMS = [
  'temperature_2m_max', 'temperature_2m_min',
  'apparent_temperature_max', 'apparent_temperature_min',
  'precipitation_sum', 'precipitation_probability_max', 'snowfall_sum',
  'weather_code', 'wind_speed_10m_max', 'wind_gusts_10m_max',
  'uv_index_max', 'sunrise', 'sunset',
].join(',');

const CURRENT_PARAMS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
  'weather_code', 'precipitation', 'cloud_cover', 'surface_pressure',
  'is_day', 'uv_index',
].join(',');

// MARK: - Standard Forecast Fetch

export async function fetchOpenMeteoWeather(location: LocationInfo): Promise<WeatherData> {
  const { latitude, longitude } = location;

  const url = `${BASE_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&current=${CURRENT_PARAMS}` +
    `&hourly=${HOURLY_PARAMS}` +
    `&daily=${DAILY_PARAMS}` +
    `&minutely_15=precipitation,precipitation_probability,snowfall` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&forecast_days=16&forecast_hours=168` +
    `&timezone=auto`;

  const res = await fetch(url, { next: { revalidate: 900 } }); // 15 min cache
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`);
  const data: OpenMeteoResponse = await res.json();

  return mapOpenMeteoResponse(data, location);
}

// MARK: - Blended Fetch (HRRR + NBM + GFS)

const MODELS = {
  hrrr: { id: 'ncep_hrrr_conus', maxHours: 48 },
  nbm:  { id: 'ncep_nbm_conus',  maxHours: 192 },
  gfs:  { id: 'gfs_seamless',     maxHours: 384 },
} as const;

type ModelKey = keyof typeof MODELS;

/** Blended weight table matching iOS BlendedWeatherProvider */
function getWeights(hoursAhead: number): Record<ModelKey, number> {
  if (hoursAhead <= 6)  return { hrrr: 0.60, nbm: 0.30, gfs: 0.10 };
  if (hoursAhead <= 18) return { hrrr: 0.40, nbm: 0.40, gfs: 0.20 };
  if (hoursAhead <= 48) return { hrrr: 0.15, nbm: 0.55, gfs: 0.30 };
  if (hoursAhead <= 192) return { hrrr: 0, nbm: 0.40, gfs: 0.60 };
  return { hrrr: 0, nbm: 0, gfs: 1.0 };
}

async function fetchModel(modelKey: ModelKey, lat: number, lon: number): Promise<OpenMeteoResponse | null> {
  const model = MODELS[modelKey];
  const url = `${BASE_URL}?latitude=${lat}&longitude=${lon}` +
    `&models=${model.id}` +
    `&hourly=${HOURLY_PARAMS}` +
    `&daily=${DAILY_PARAMS}` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&forecast_hours=${model.maxHours}` +
    `&timezone=auto`;

  try {
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchBlendedWeather(location: LocationInfo): Promise<WeatherData> {
  const { latitude, longitude } = location;

  // Fetch all three models in parallel
  const [hrrr, nbm, gfs] = await Promise.all([
    fetchModel('hrrr', latitude, longitude),
    fetchModel('nbm', latitude, longitude),
    fetchModel('gfs', latitude, longitude),
  ]);

  // If blending fails, fall back to standard fetch
  if (!hrrr && !nbm && !gfs) {
    return fetchOpenMeteoWeather(location);
  }

  // Map each model
  const hrrrData = hrrr ? mapOpenMeteoResponse(hrrr, location) : null;
  const nbmData = nbm ? mapOpenMeteoResponse(nbm, location) : null;
  const gfsData = gfs ? mapOpenMeteoResponse(gfs, location) : null;

  // Use the best available current conditions (prefer HRRR for near-term)
  const current = (hrrrData ?? nbmData ?? gfsData)!.current;

  // Blend hourly forecasts
  const now = Date.now();
  const maxLen = Math.max(
    hrrrData?.hourly.length ?? 0,
    nbmData?.hourly.length ?? 0,
    gfsData?.hourly.length ?? 0
  );

  const blendedHourly: HourlyForecast[] = [];
  for (let i = 0; i < maxLen; i++) {
    const candidates: { data: HourlyForecast; model: ModelKey }[] = [];
    if (hrrrData && i < hrrrData.hourly.length) candidates.push({ data: hrrrData.hourly[i], model: 'hrrr' });
    if (nbmData && i < nbmData.hourly.length) candidates.push({ data: nbmData.hourly[i], model: 'nbm' });
    if (gfsData && i < gfsData.hourly.length) candidates.push({ data: gfsData.hourly[i], model: 'gfs' });

    if (!candidates.length) continue;

    const hoursAhead = (new Date(candidates[0].data.time).getTime() - now) / 3600000;
    const weights = getWeights(Math.max(0, hoursAhead));

    // Normalize weights to available models
    let totalWeight = candidates.reduce((s, c) => s + weights[c.model], 0);
    if (totalWeight === 0) totalWeight = 1;

    const blend = (getter: (h: HourlyForecast) => number) =>
      candidates.reduce((s, c) => s + getter(c.data) * weights[c.model] / totalWeight, 0);

    const base = candidates[0].data;
    blendedHourly.push({
      ...base,
      temperature: blend(h => h.temperature),
      feelsLike: blend(h => h.feelsLike),
      humidity: blend(h => h.humidity),
      windSpeed: blend(h => h.windSpeed),
      precipProbability: blend(h => h.precipProbability),
      precipIntensity: blend(h => h.precipIntensity),
      precipAccumulation: blend(h => h.precipAccumulation),
      precipAmountLow: Math.min(...candidates.map(c => c.data.precipAccumulation)),
      precipAmountHigh: Math.max(...candidates.map(c => c.data.precipAccumulation)),
    });
  }

  // Use the longest daily forecast available
  const daily = (gfsData ?? nbmData ?? hrrrData)!.daily;

  return {
    location,
    current,
    hourly: blendedHourly,
    daily,
    stormEvents: [],
    weatherAlerts: [],
    minutely: (hrrrData ?? nbmData ?? gfsData)?.minutely ?? null,
    past24hPrecipitation: null,
    past24hPrecipType: null,
    tideData: null,
    fetchedAt: new Date().toISOString(),
    provider: 'Blended',
    providerNote: null,
  };
}

// MARK: - Historical Weather (for accuracy comparison)

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  date: string // YYYY-MM-DD
): Promise<{
  high: number;
  low: number;
  precipTotal: number;
  condition: WeatherCondition;
} | null> {
  const url = `${HISTORICAL_URL}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${date}&end_date=${date}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=auto`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.daily;
    if (!d || !d.time.length) return null;

    return {
      high: d.temperature_2m_max[0],
      low: d.temperature_2m_min[0],
      precipTotal: d.precipitation_sum[0],
      condition: wmoToCondition(d.weather_code[0], true),
    };
  } catch {
    return null;
  }
}

// MARK: - Response Mapper

function mapOpenMeteoResponse(resp: OpenMeteoResponse, location: LocationInfo): WeatherData {
  const hourly: HourlyForecast[] = [];
  if (resp.hourly) {
    const h = resp.hourly;
    for (let i = 0; i < h.time.length; i++) {
      const temp = h.temperature_2m[i];
      const isDay = h.is_day[i] === 1;
      const code = h.weather_code[i];
      hourly.push({
        time: new Date(h.time[i]).toISOString(),
        temperature: temp,
        feelsLike: h.apparent_temperature[i],
        humidity: h.relative_humidity_2m[i] / 100,
        windSpeed: h.wind_speed_10m[i],
        windGust: h.wind_gusts_10m[i] || null,
        condition: wmoToCondition(code, isDay),
        precipProbability: (h.precipitation_probability[i] || 0) / 100,
        precipIntensity: h.precipitation[i] || 0,
        precipAccumulation: h.precipitation[i] || 0,
        precipType: wmoPrecipType(code, temp),
        cloudCover: h.cloud_cover[i] != null ? h.cloud_cover[i] / 100 : null,
        uvIndex: h.uv_index[i] ?? null,
        isDaylight: isDay,
      });
    }
  }

  const daily: DailyForecast[] = [];
  if (resp.daily) {
    const d = resp.daily;
    for (let i = 0; i < d.time.length; i++) {
      const code = d.weather_code[i];
      const high = d.temperature_2m_max[i];
      const low = d.temperature_2m_min[i];
      const snowInches = d.snowfall_sum[i] || 0;
      const precipInches = d.precipitation_sum[i] || 0;
      const pType = snowInches > precipInches * 0.5 ? 'snow' as const :
        code >= 66 && code <= 67 ? 'sleet' as const :
        precipInches > 0 ? 'rain' as const : 'none' as const;

      daily.push({
        time: new Date(d.time[i]).toISOString(),
        temperatureHigh: high,
        temperatureLow: low,
        temperatureHighTime: null,
        temperatureLowTime: null,
        feelsLikeHigh: d.apparent_temperature_max[i],
        feelsLikeLow: d.apparent_temperature_min[i],
        humidity: 0.5, // daily avg not available, placeholder
        windSpeed: d.wind_speed_10m_max[i],
        windGust: d.wind_gusts_10m_max[i] || null,
        conditionDay: wmoToCondition(code, true),
        conditionNight: wmoToCondition(code, false),
        summary: wmoToCondition(code, true),
        precipProbability: (d.precipitation_probability_max[i] || 0) / 100,
        precipAccumulation: precipInches,
        precipType: pType,
        snowAccumulation: snowInches,
        cloudCover: null,
        uvIndex: d.uv_index_max[i] ?? null,
        dewPoint: null,
        sunrise: d.sunrise[i] ? new Date(d.sunrise[i]).toISOString() : null,
        sunset: d.sunset[i] ? new Date(d.sunset[i]).toISOString() : null,
        moonPhase: null,
      });
    }
  }

  // Map minutely_15 to MinutelyForecast (interpolate to 1-min if needed)
  let minutely: MinutelyForecast[] | null = null;
  if (resp.minutely_15) {
    const m = resp.minutely_15;
    minutely = m.time.map((t, i) => ({
      time: new Date(t).toISOString(),
      precipIntensity: m.precipitation[i] || 0,
      precipProbability: m.precipitation_probability ? m.precipitation_probability[i] / 100 : 0,
      precipType: (m.snowfall && m.snowfall[i] > 0) ? 'snow' as const : m.precipitation[i] > 0 ? 'rain' as const : 'none' as const,
    }));
  }

  // Build current from first hourly or current block
  let current: CurrentWeather;
  if (resp.current) {
    const c = resp.current;
    const isDay = c.is_day === 1;
    current = {
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m / 100,
      windSpeed: c.wind_speed_10m,
      windGust: c.wind_gusts_10m || null,
      windBearing: c.wind_direction_10m || null,
      pressure: c.surface_pressure || null,
      dewPoint: null,
      uvIndex: c.uv_index ?? null,
      visibility: null,
      cloudCover: c.cloud_cover != null ? c.cloud_cover / 100 : null,
      condition: wmoToCondition(c.weather_code, isDay),
      summary: wmoToCondition(c.weather_code, isDay),
      precipProbability: hourly.length > 0 ? hourly[0].precipProbability : 0,
      precipIntensity: c.precipitation || null,
    };
  } else if (hourly.length > 0) {
    const h = hourly[0];
    current = {
      temperature: h.temperature,
      feelsLike: h.feelsLike,
      humidity: h.humidity,
      windSpeed: h.windSpeed,
      windGust: h.windGust,
      windBearing: null,
      pressure: null,
      dewPoint: null,
      uvIndex: h.uvIndex,
      visibility: null,
      cloudCover: h.cloudCover,
      condition: h.condition,
      summary: h.condition,
      precipProbability: h.precipProbability,
      precipIntensity: h.precipIntensity,
    };
  } else {
    throw new Error('No current or hourly data in Open-Meteo response');
  }

  return {
    location,
    current,
    hourly,
    daily,
    stormEvents: [],
    weatherAlerts: [],
    minutely,
    past24hPrecipitation: null,
    past24hPrecipType: null,
    tideData: null,
    fetchedAt: new Date().toISOString(),
    provider: 'Open-Meteo',
    providerNote: null,
  };
}
