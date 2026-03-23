// =============================================================================
// NOAA CO-OPS Tides API — Free, no API key
// =============================================================================

import { TideData, TideEntry } from './types';

const BASE_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

interface NOAAStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface NOAAPrediction {
  t: string; // "2024-01-15 08:30"
  v: string; // height in feet
  type?: string; // "H" or "L" for high/low
}

/** Find nearest tide station within ~50 miles */
export async function findNearestStation(lat: number, lon: number): Promise<NOAAStation | null> {
  try {
    const res = await fetch(
      'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions',
      { next: { revalidate: 86400 } } // cache 24h
    );
    if (!res.ok) return null;
    const data = await res.json();

    const stations: NOAAStation[] = (data.stations || []).map((s: { id: string; name: string; lat: number; lng: number }) => ({
      id: s.id, name: s.name, lat: s.lat, lng: s.lng,
    }));

    // Find nearest within ~50 miles (0.72 degrees approx)
    let nearest: NOAAStation | null = null;
    let minDist = Infinity;
    for (const s of stations) {
      const d = Math.sqrt((s.lat - lat) ** 2 + (s.lng - lon) ** 2);
      if (d < 0.72 && d < minDist) {
        minDist = d;
        nearest = s;
      }
    }
    return nearest;
  } catch {
    return null;
  }
}

export async function fetchTideData(lat: number, lon: number): Promise<TideData | null> {
  const station = await findNearestStation(lat, lon);
  if (!station) return null;

  const now = new Date();
  const start = new Date(now.getTime() - 12 * 3600000); // 12h ago
  const end = new Date(now.getTime() + 48 * 3600000);   // 48h ahead

  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  // Fetch predictions and hi/lo in parallel
  const [predRes, hiloRes] = await Promise.all([
    fetch(`${BASE_URL}?station=${station.id}&begin_date=${fmt(start)}&end_date=${fmt(end)}&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&interval=h&format=json`,
      { next: { revalidate: 3600 } }),
    fetch(`${BASE_URL}?station=${station.id}&begin_date=${fmt(start)}&end_date=${fmt(end)}&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&interval=hilo&format=json`,
      { next: { revalidate: 3600 } }),
  ]);

  if (!predRes.ok) return null;
  const predData = await predRes.json();
  const hiloData = hiloRes.ok ? await hiloRes.json() : { predictions: [] };

  const entries: TideEntry[] = (predData.predictions || []).map((p: NOAAPrediction) => ({
    time: new Date(p.t).toISOString(),
    height: parseFloat(p.v),
    type: null,
  }));

  const highLow: TideEntry[] = (hiloData.predictions || []).map((p: NOAAPrediction) => ({
    time: new Date(p.t).toISOString(),
    height: parseFloat(p.v),
    type: p.type === 'H' ? 'H' as const : 'L' as const,
  }));

  return { station: station.name, entries, highLow };
}
