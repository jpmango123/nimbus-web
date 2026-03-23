// =============================================================================
// GET /api/weather?lat=42.36&lon=-71.06&name=Boston
// Fetches blended weather data for a location
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { fetchBlendedWeather } from '@/lib/weather/open-meteo';
import { fetchNWSAlerts } from '@/lib/weather/nws';
import { fetchTideData } from '@/lib/weather/noaa-tides';
import { getCachedWeather, setCachedWeather } from '@/lib/cache';
import { LocationInfo } from '@/lib/weather/types';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = parseFloat(searchParams.get('lat') || '');
  const lon = parseFloat(searchParams.get('lon') || '');
  const name = searchParams.get('name') || 'Unknown';
  const tz = searchParams.get('tz') || 'America/New_York';

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: 'lat and lon required' }, { status: 400 });
  }

  // Check cache
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const cached = await getCachedWeather(cacheKey);
  if (cached) {
    return NextResponse.json(JSON.parse(cached));
  }

  const location: LocationInfo = { name, latitude: lat, longitude: lon, timezone: tz };

  try {
    // Fetch weather, alerts, and tides in parallel
    const [weather, alerts, tides] = await Promise.all([
      fetchBlendedWeather(location),
      fetchNWSAlerts(lat, lon),
      fetchTideData(lat, lon),
    ]);

    weather.weatherAlerts = alerts;
    weather.tideData = tides;

    // Cache result
    const json = JSON.stringify(weather);
    await setCachedWeather(cacheKey, json);

    return NextResponse.json(weather);
  } catch (err) {
    console.error('[WEATHER] Fetch failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch weather data' },
      { status: 500 }
    );
  }
}
