// =============================================================================
// GET /api/debug?lat=42.36&lon=-71.06&name=Boston
// Returns per-model raw data alongside blended output for diagnostic comparison
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { fetchOpenMeteoWeather, fetchPerModelData } from '@/lib/weather/open-meteo';
import { fetchNWSAlerts } from '@/lib/weather/nws';
import { LocationInfo } from '@/lib/weather/types';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = parseFloat(searchParams.get('lat') || '42.36');
  const lon = parseFloat(searchParams.get('lon') || '-71.06');
  const name = searchParams.get('name') || 'Boston, MA';
  const tz = searchParams.get('tz') || 'America/New_York';

  const location: LocationInfo = { name, latitude: lat, longitude: lon, timezone: tz };

  try {
    // Fetch blended + per-model + alerts in parallel
    const [blended, perModel, alerts] = await Promise.all([
      fetchOpenMeteoWeather(location),
      fetchPerModelData(lat, lon),
      fetchNWSAlerts(lat, lon),
    ]);

    // Build comparison table: for each day, show what each model says vs blended
    const dailyComparison = blended.daily.slice(0, 7).map((day, i) => ({
      date: day.time,
      blended: {
        high: day.temperatureHigh,
        low: day.temperatureLow,
        precipProb: day.precipProbability,
        precipAccum: day.precipAccumulation,
        precipType: day.precipType,
        condition: day.conditionDay,
      },
      hrrr: perModel.hrrr?.[i] ? {
        high: perModel.hrrr[i].high,
        low: perModel.hrrr[i].low,
        precipProb: perModel.hrrr[i].precipProb,
        precipAccum: perModel.hrrr[i].precipAccum,
      } : null,
      nbm: perModel.nbm?.[i] ? {
        high: perModel.nbm[i].high,
        low: perModel.nbm[i].low,
        precipProb: perModel.nbm[i].precipProb,
        precipAccum: perModel.nbm[i].precipAccum,
      } : null,
      gfs: perModel.gfs?.[i] ? {
        high: perModel.gfs[i].high,
        low: perModel.gfs[i].low,
        precipProb: perModel.gfs[i].precipProb,
        precipAccum: perModel.gfs[i].precipAccum,
      } : null,
    }));

    // Hourly comparison for first 24 hours
    const hourlyPreview = blended.hourly.slice(0, 24).map(h => ({
      time: h.time,
      temp: h.temperature,
      precipProb: h.precipProbability,
      precipIntensity: h.precipIntensity,
      precipType: h.precipType,
      condition: h.condition,
      windSpeed: h.windSpeed,
      confidenceLow: h.precipAmountLow,
      confidenceHigh: h.precipAmountHigh,
    }));

    return NextResponse.json({
      location,
      provider: blended.provider,
      fetchedAt: blended.fetchedAt,
      alerts: alerts.length,
      blendingWeights: {
        description: 'HRRR/NBM/GFS weights by forecast horizon',
        '0-6h': { hrrr: 0.60, nbm: 0.30, gfs: 0.10 },
        '6-18h': { hrrr: 0.40, nbm: 0.40, gfs: 0.20 },
        '18-48h': { hrrr: 0.15, nbm: 0.55, gfs: 0.30 },
        '48-192h': { hrrr: 0, nbm: 0.40, gfs: 0.60 },
        '192h+': { hrrr: 0, nbm: 0, gfs: 1.0 },
      },
      dailyComparison,
      hourlyPreview,
      minutelyAvailable: (blended.minutely?.length || 0) > 0,
      minutelyCount: blended.minutely?.length || 0,
      totalHourly: blended.hourly.length,
      totalDaily: blended.daily.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
