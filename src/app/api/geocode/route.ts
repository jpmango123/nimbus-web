// =============================================================================
// GET /api/geocode?q=Boston — Free geocoding via Nominatim (OpenStreetMap)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'Query too short' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=us`,
      {
        headers: { 'User-Agent': 'NimbusWeatherWebApp/1.0' },
        next: { revalidate: 86400 }, // cache 24h
      }
    );

    if (!res.ok) return NextResponse.json({ error: 'Geocoding failed' }, { status: 502 });

    const results: NominatimResult[] = await res.json();

    const locations = results.map(r => {
      const city = r.address.city || r.address.town || r.address.village || '';
      const state = r.address.state || '';
      const name = city && state ? `${city}, ${state}` : r.display_name.split(',').slice(0, 2).join(',').trim();

      // Guess timezone from longitude
      const lon = parseFloat(r.lon);
      let timezone = 'America/New_York';
      if (lon < -115) timezone = 'America/Los_Angeles';
      else if (lon < -100) timezone = 'America/Denver';
      else if (lon < -85) timezone = 'America/Chicago';
      else timezone = 'America/New_York';

      return {
        name,
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon),
        timezone,
        fullAddress: r.display_name,
      };
    });

    return NextResponse.json(locations);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
