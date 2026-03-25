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

/** Statistical mode — returns the most frequent value in an array */
function mode(arr: number[]): number {
  const counts: Record<number, number> = {};
  let maxCount = 0;
  let result = arr[0];
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > maxCount) {
      maxCount = counts[v];
      result = v;
    }
  }
  return result;
}

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
  if (hoursAhead <= 6)  return { hrrr: 0.70, nbm: 0.25, gfs: 0.05 };
  if (hoursAhead <= 18) return { hrrr: 0.35, nbm: 0.45, gfs: 0.20 };
  if (hoursAhead <= 48) return { hrrr: hoursAhead <= 42 ? 0.15 : 0, nbm: hoursAhead <= 42 ? 0.55 : 0.65, gfs: hoursAhead <= 42 ? 0.30 : 0.35 };
  if (hoursAhead <= 192) return { hrrr: 0, nbm: 0.40, gfs: 0.60 };
  return { hrrr: 0, nbm: 0, gfs: 1.0 };
}

/** Fetch minutely (15-min) precipitation data from HRRR specifically.
 *  HRRR has the best short-range precipitation timing due to radar assimilation.
 *  Falls back to the default minutely_15 endpoint if HRRR-specific fails. */
async function fetchMinutely15(lat: number, lon: number): Promise<MinutelyForecast[] | null> {
  // Use the HRRR model specifically for minutely data (best radar-driven timing)
  const url = `${BASE_URL}?latitude=${lat}&longitude=${lon}` +
    `&models=ncep_hrrr_conus` +
    `&minutely_15=precipitation,precipitation_probability,snowfall` +
    `&precipitation_unit=inch` +
    `&forecast_hours=3` +
    `&timezone=auto`;

  try {
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return null;
    const data = await res.json();
    const m = data.minutely_15;
    if (!m?.time?.length) return null;

    return m.time.map((t: string, i: number) => ({
      time: new Date(t).toISOString(),
      precipIntensity: (m.precipitation?.[i] || 0) * 4, // 15-min to hourly rate
      precipProbability: m.precipitation_probability ? m.precipitation_probability[i] / 100 : 0,
      precipType: (m.snowfall && m.snowfall[i] > 0) ? 'snow' as const : (m.precipitation?.[i] || 0) > 0 ? 'rain' as const : 'none' as const,
    }));
  } catch {
    return null;
  }
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

/** Validate that HRRR hourly data is real (not a data ingestion failure).
 *  HRRR sometimes returns 0°F temps which means the API returned no data. */
function isValidHourly(h: HourlyForecast): boolean {
  // Reject impossibly cold temps (HRRR zero-value failure)
  if (h.temperature === 0 && h.feelsLike === 0) return false;
  // Reject if temp is outside physically plausible range for CONUS
  if (h.temperature < -60 || h.temperature > 140) return false;
  return true;
}

/** Consensus-weighted precipitation blending.
 *  Instead of simple weighted average (which dilutes storm signals),
 *  uses model agreement to decide between averaging and max-of-models.
 *
 *  Meteorological rationale:
 *  - If all models agree on precip, weighted average is fine
 *  - If models disagree strongly, one model "sees" a storm the others don't
 *    → use the precipitating model's value scaled by consensus fraction
 *  - Probability uses the max across models (if ANY model says 80%, report it)
 *    weighted by how many models agree
 */
function blendPrecipitation(
  candidates: { data: HourlyForecast; model: ModelKey }[],
  weights: Record<ModelKey, number>,
  totalWeight: number,
): { probability: number; intensity: number; accumulation: number } {
  if (candidates.length === 0) return { probability: 0, intensity: 0, accumulation: 0 };
  if (candidates.length === 1) {
    const d = candidates[0].data;
    return { probability: d.precipProbability, intensity: d.precipIntensity, accumulation: d.precipAccumulation };
  }

  const probs = candidates.map(c => c.data.precipProbability);
  const amounts = candidates.map(c => c.data.precipAccumulation);
  const intensities = candidates.map(c => c.data.precipIntensity);

  // How many models show significant precipitation?
  const precipThreshold = 0.01; // inches
  const probThreshold = 0.15;   // 15%
  const precipitatingModels = candidates.filter(
    c => c.data.precipAccumulation > precipThreshold || c.data.precipProbability > probThreshold
  );
  const consensusFraction = precipitatingModels.length / candidates.length;

  // PROBABILITY: Use weighted-max approach
  // If any high-skill model says high probability, don't average it away
  const maxProb = Math.max(...probs);
  const weightedAvgProb = candidates.reduce(
    (s, c) => s + c.data.precipProbability * weights[c.model] / totalWeight, 0
  );
  // Blend between max and average based on consensus
  // High consensus → trust average; low consensus → lean toward max (one model sees something)
  const probability = consensusFraction >= 0.5
    ? weightedAvgProb * 0.6 + maxProb * 0.4
    : weightedAvgProb * 0.3 + maxProb * 0.7;

  // AMOUNT: Use consensus-scaled approach
  const maxAmount = Math.max(...amounts);
  const maxIntensity = Math.max(...intensities);

  if (maxAmount <= precipThreshold) {
    // No significant precip from any model — simple weighted average
    const intensity = candidates.reduce(
      (s, c) => s + c.data.precipIntensity * weights[c.model] / totalWeight, 0
    );
    const accumulation = candidates.reduce(
      (s, c) => s + c.data.precipAccumulation * weights[c.model] / totalWeight, 0
    );
    return { probability, intensity, accumulation };
  }

  if (consensusFraction >= 0.5) {
    // Majority of models agree on precip — weighted average is reasonable
    const intensity = candidates.reduce(
      (s, c) => s + c.data.precipIntensity * weights[c.model] / totalWeight, 0
    );
    const accumulation = candidates.reduce(
      (s, c) => s + c.data.precipAccumulation * weights[c.model] / totalWeight, 0
    );
    return { probability, intensity, accumulation };
  }

  // Low consensus: one model sees a storm others don't
  // Use the precipitating model's value, scaled down by consensus but never below 30%
  // This preserves storm signals that would otherwise be averaged to nothing
  const scaleFactor = Math.max(0.3, consensusFraction);
  return {
    probability,
    intensity: maxIntensity * scaleFactor,
    accumulation: maxAmount * scaleFactor,
  };
}

/** Determine blended precipitation type using temperature-aware voting.
 *  At marginal temps (28-36°F), boost snow predictions. */
function blendPrecipType(
  candidates: { data: HourlyForecast; model: ModelKey }[],
  blendedTemp: number,
): PrecipitationType {
  const votes: Record<string, number> = { rain: 0, snow: 0, sleet: 0, none: 0 };
  for (const c of candidates) {
    let weight = 1;
    const type = c.data.precipType;
    // At marginal temps, boost snow/sleet predictions
    if (blendedTemp >= 28 && blendedTemp <= 36) {
      if (type === 'snow') weight = 1.4;
      else if (type === 'rain') weight = 0.6;
    }
    votes[type] += weight;
  }
  // If blended temp strongly suggests a type, override
  if (votes.none > votes.rain + votes.snow + votes.sleet) return 'none';
  // Only consider precipitating types
  const precipVotes = Object.entries(votes).filter(([k]) => k !== 'none').sort((a, b) => b[1] - a[1]);
  return (precipVotes[0]?.[0] as PrecipitationType) || 'none';
}

export async function fetchBlendedWeather(location: LocationInfo): Promise<WeatherData> {
  const { latitude, longitude } = location;

  // Fetch all three models + HRRR minutely in parallel
  const [hrrr, nbm, gfs, hrrrMinutely] = await Promise.all([
    fetchModel('hrrr', latitude, longitude),
    fetchModel('nbm', latitude, longitude),
    fetchModel('gfs', latitude, longitude),
    fetchMinutely15(latitude, longitude),
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
    // Validate HRRR data before including it
    if (hrrrData && i < hrrrData.hourly.length && isValidHourly(hrrrData.hourly[i])) {
      candidates.push({ data: hrrrData.hourly[i], model: 'hrrr' });
    }
    if (nbmData && i < nbmData.hourly.length) candidates.push({ data: nbmData.hourly[i], model: 'nbm' });
    if (gfsData && i < gfsData.hourly.length) candidates.push({ data: gfsData.hourly[i], model: 'gfs' });

    if (!candidates.length) continue;

    const hoursAhead = (new Date(candidates[0].data.time).getTime() - now) / 3600000;
    const weights = getWeights(Math.max(0, hoursAhead));

    // Normalize weights to available models
    let totalWeight = candidates.reduce((s, c) => s + weights[c.model], 0);
    if (totalWeight === 0) totalWeight = 1;

    // Temperature: standard weighted average (works well for continuous values)
    const blendTemp = (getter: (h: HourlyForecast) => number) =>
      candidates.reduce((s, c) => s + getter(c.data) * weights[c.model] / totalWeight, 0);

    const blendedTemperature = blendTemp(h => h.temperature);

    // Precipitation: consensus-weighted blending (handles storm disagreement)
    const precip = blendPrecipitation(candidates, weights, totalWeight);

    // Precipitation type: temperature-aware voting
    const precipType = blendPrecipType(candidates, blendedTemperature);

    const base = candidates[0].data;
    blendedHourly.push({
      ...base,
      temperature: blendedTemperature,
      feelsLike: blendTemp(h => h.feelsLike),
      humidity: blendTemp(h => h.humidity),
      windSpeed: blendTemp(h => h.windSpeed),
      precipProbability: precip.probability,
      precipIntensity: precip.intensity,
      precipAccumulation: precip.accumulation,
      precipType,
      precipAmountLow: Math.min(...candidates.map(c => c.data.precipAccumulation)),
      precipAmountHigh: Math.max(...candidates.map(c => c.data.precipAccumulation)),
    });
  }

  // Blend daily forecasts (don't just use GFS — blend highs/lows too)
  const dailySources = [hrrrData, nbmData, gfsData].filter(Boolean) as WeatherData[];
  const longestDaily = dailySources.reduce((a, b) => a.daily.length >= b.daily.length ? a : b);
  const blendedDaily: DailyForecast[] = longestDaily.daily.map((baseDay, dayIdx) => {
    const dayCandidates: DailyForecast[] = [];
    for (const src of dailySources) {
      if (dayIdx < src.daily.length) dayCandidates.push(src.daily[dayIdx]);
    }
    if (dayCandidates.length <= 1) return baseDay;

    // Simple average for daily temp (all models usually available)
    const avgHigh = dayCandidates.reduce((s, d) => s + d.temperatureHigh, 0) / dayCandidates.length;
    const avgLow = dayCandidates.reduce((s, d) => s + d.temperatureLow, 0) / dayCandidates.length;

    // For daily precip, use max probability and consensus-scaled accumulation
    const maxProb = Math.max(...dayCandidates.map(d => d.precipProbability));
    const avgProb = dayCandidates.reduce((s, d) => s + d.precipProbability, 0) / dayCandidates.length;
    const precipModels = dayCandidates.filter(d => d.precipAccumulation > 0.01);
    const consensus = precipModels.length / dayCandidates.length;
    const maxAccum = Math.max(...dayCandidates.map(d => d.precipAccumulation));
    const avgAccum = dayCandidates.reduce((s, d) => s + d.precipAccumulation, 0) / dayCandidates.length;

    return {
      ...baseDay,
      temperatureHigh: avgHigh,
      temperatureLow: avgLow,
      precipProbability: consensus >= 0.5 ? avgProb * 0.6 + maxProb * 0.4 : avgProb * 0.3 + maxProb * 0.7,
      precipAccumulation: consensus >= 0.5 ? avgAccum : maxAccum * Math.max(0.3, consensus),
      snowAccumulation: Math.max(...dayCandidates.map(d => d.snowAccumulation)) * Math.max(0.3, consensus),
    };
  });

  return {
    location,
    current,
    hourly: blendedHourly,
    daily: blendedDaily,
    stormEvents: [],
    weatherAlerts: [],
    minutely: hrrrMinutely ?? (hrrrData ?? nbmData ?? gfsData)?.minutely ?? null,
    past24hPrecipitation: null,
    past24hPrecipType: null,
    tideData: null,
    fetchedAt: new Date().toISOString(),
    provider: 'Blended',
    providerNote: null,
  };
}

// MARK: - Per-Model Data (for blending analysis)

export interface PerModelDailyData {
  high: number;
  low: number;
  precipProb: number;
  precipAccum: number;
  condition: string;
  model: string;
}

/** Fetch individual HRRR, NBM, GFS daily forecasts for comparison/analysis */
export async function fetchPerModelData(lat: number, lon: number): Promise<{
  hrrr: PerModelDailyData[] | null;
  nbm: PerModelDailyData[] | null;
  gfs: PerModelDailyData[] | null;
}> {
  async function fetchModelDaily(modelId: string, modelName: string): Promise<PerModelDailyData[] | null> {
    const url = `${BASE_URL}?latitude=${lat}&longitude=${lon}` +
      `&models=${modelId}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code` +
      `&temperature_unit=fahrenheit&precipitation_unit=inch` +
      `&forecast_days=7&timezone=auto`;

    try {
      const res = await fetch(url, { next: { revalidate: 900 } });
      if (!res.ok) return null;
      const data = await res.json();
      const d = data.daily;
      if (!d?.time?.length) return null;

      return d.time.map((_: string, i: number) => ({
        high: d.temperature_2m_max[i],
        low: d.temperature_2m_min[i],
        precipProb: (d.precipitation_probability_max?.[i] || 0) / 100,
        precipAccum: d.precipitation_sum[i] || 0,
        condition: String(d.weather_code[i]),
        model: modelName,
      }));
    } catch {
      return null;
    }
  }

  const [hrrr, nbm, gfs] = await Promise.all([
    fetchModelDaily('ncep_hrrr_conus', 'HRRR'),
    fetchModelDaily('ncep_nbm_conus', 'NBM'),
    fetchModelDaily('gfs_seamless', 'GFS'),
  ]);

  return { hrrr, nbm, gfs };
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
  precipType: PrecipitationType;
  condition: WeatherCondition;
  windSpeedMax: number | null;
} | null> {
  const url = `${HISTORICAL_URL}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${date}&end_date=${date}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weather_code,wind_speed_10m_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=auto`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.daily;
    if (!d || !d.time.length) return null;

    const precipTotal = d.precipitation_sum[0] || 0;
    const snowfall = d.snowfall_sum?.[0] || 0; // snowfall in cm from API
    const snowInches = cmToInches(snowfall);

    // Determine actual precip type from snowfall vs total precipitation
    let precipType: PrecipitationType = 'none';
    if (precipTotal > 0.01) {
      if (snowInches > precipTotal * 0.5) precipType = 'snow';
      else if (snowInches > 0.01) precipType = 'sleet';
      else precipType = 'rain';
    }

    return {
      high: d.temperature_2m_max[0],
      low: d.temperature_2m_min[0],
      precipTotal,
      precipType,
      condition: wmoToCondition(d.weather_code[0], true),
      windSpeedMax: d.wind_speed_10m_max?.[0] ?? null,
    };
  } catch {
    return null;
  }
}

// MARK: - Hourly Historical Weather (for graph accuracy comparison)

export interface HourlyActual {
  time: string;           // ISO 8601
  temperature: number;    // °F
  precipitation: number;  // inches (1h total)
  snowfall: number;       // inches (1h)
  windSpeed: number;      // mph
  weatherCode: number;
}

/** Fetch hourly historical weather for a date range.
 *  Used to compare hourly forecast graphs against what actually happened. */
export async function fetchHourlyHistorical(
  lat: number,
  lon: number,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
): Promise<HourlyActual[] | null> {
  const url = `${HISTORICAL_URL}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,precipitation,snowfall,wind_speed_10m,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=auto`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const h = data.hourly;
    if (!h || !h.time?.length) return null;

    return h.time.map((_: string, i: number) => ({
      time: new Date(h.time[i]).toISOString(),
      temperature: h.temperature_2m[i],
      precipitation: h.precipitation[i] || 0,
      snowfall: cmToInches(h.snowfall?.[i] || 0),
      windSpeed: h.wind_speed_10m?.[i] || 0,
      weatherCode: h.weather_code?.[i] || 0,
    }));
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

      // Derive conditionDay/Night from hourly data if available.
      // The daily WMO code represents the whole 24h period, which means
      // evening clouds can make a sunny day show as "cloudy".
      // Instead, use the most common daytime condition (7am-7pm) and nighttime (7pm-7am).
      let condDay: WeatherCondition = wmoToCondition(code, true);
      let condNight: WeatherCondition = wmoToCondition(code, false);

      if (resp.hourly) {
        const dayStart = i * 24 + 7;  // 7am
        const dayEnd = i * 24 + 19;   // 7pm
        const nightStart = i * 24 + 19;
        const nightEnd = i * 24 + 24 + 7; // 7am next day

        const h = resp.hourly;
        // Get most significant daytime condition (precipitation > clouds > clear)
        const daytimeHours = [];
        for (let hi = dayStart; hi < dayEnd && hi < h.time.length; hi++) {
          daytimeHours.push({ code: h.weather_code[hi], isDay: h.is_day[hi] === 1 });
        }
        const nighttimeHours = [];
        for (let hi = nightStart; hi < nightEnd && hi < h.time.length; hi++) {
          nighttimeHours.push({ code: h.weather_code[hi], isDay: h.is_day[hi] === 1 });
        }

        if (daytimeHours.length > 0) {
          // Find the "most representative" condition by picking the most common,
          // but prioritize precipitation codes over non-precipitation ones
          const precipHours = daytimeHours.filter(dh => dh.code >= 51);
          if (precipHours.length >= daytimeHours.length * 0.3) {
            // 30%+ of daytime has precipitation — use precip condition
            const mostCommonPrecipCode = mode(precipHours.map(dh => dh.code));
            condDay = wmoToCondition(mostCommonPrecipCode, true);
          } else {
            // Use most common daytime condition
            const mostCommonCode = mode(daytimeHours.map(dh => dh.code));
            condDay = wmoToCondition(mostCommonCode, true);
          }
        }

        if (nighttimeHours.length > 0) {
          const precipHoursN = nighttimeHours.filter(nh => nh.code >= 51);
          if (precipHoursN.length >= nighttimeHours.length * 0.3) {
            const mostCommonPrecipCode = mode(precipHoursN.map(nh => nh.code));
            condNight = wmoToCondition(mostCommonPrecipCode, false);
          } else {
            const mostCommonCode = mode(nighttimeHours.map(nh => nh.code));
            condNight = wmoToCondition(mostCommonCode, false);
          }
        }
      }

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
        conditionDay: condDay,
        conditionNight: condNight,
        summary: condDay,
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
