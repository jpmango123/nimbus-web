'use client';

// =============================================================================
// Main Dashboard — Multi-location weather display
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { WeatherData, SavedLocation } from '@/lib/weather/types';
import WeatherPage from '@/components/weather/WeatherPage';
import Link from 'next/link';

// Default locations when database isn't configured yet
const DEFAULT_LOCATIONS: SavedLocation[] = [
  { id: 1, name: 'Boston, MA', latitude: 42.3601, longitude: -71.0589, timezone: 'America/New_York', sortOrder: 0 },
  { id: 2, name: 'New York, NY', latitude: 40.7128, longitude: -74.0060, timezone: 'America/New_York', sortOrder: 1 },
  { id: 3, name: 'Los Angeles, CA', latitude: 34.0522, longitude: -118.2437, timezone: 'America/Los_Angeles', sortOrder: 2 },
];

export default function Home() {
  const [locations, setLocations] = useState<SavedLocation[]>(DEFAULT_LOCATIONS);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [weatherCache, setWeatherCache] = useState<Record<number, WeatherData>>({});
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState<'F' | 'C'>('F');

  // Load locations from DB
  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setLocations(data);
        }
      })
      .catch(() => {
        // Use defaults if DB not configured
      });
  }, []);

  // Fetch weather for selected location
  const fetchWeather = useCallback(async (loc: SavedLocation) => {
    if (weatherCache[loc.id]) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: String(loc.latitude),
        lon: String(loc.longitude),
        name: loc.name,
        tz: loc.timezone,
      });
      const res = await fetch(`/api/weather?${params}`);
      const data = await res.json();
      if (data && !data.error) {
        setWeatherCache(prev => ({ ...prev, [loc.id]: data }));
      }
    } catch (err) {
      console.error('Weather fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [weatherCache]);

  useEffect(() => {
    if (locations[selectedIdx]) {
      fetchWeather(locations[selectedIdx]);
    }
  }, [selectedIdx, locations, fetchWeather]);

  const currentLocation = locations[selectedIdx];
  const currentWeather = currentLocation ? weatherCache[currentLocation.id] : null;

  return (
    <main className="min-h-screen">
      {/* Nav bar */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#0d1521]/80 border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">
              <span className="text-blue-400">☁️</span> Nimbus
            </h1>
          </div>

          {/* Location tabs */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {locations.map((loc, i) => (
              <button
                key={loc.id}
                onClick={() => setSelectedIdx(i)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                  i === selectedIdx
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                {loc.name.split(',')[0]}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
              className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              °{unit}
            </button>
            <Link
              href="/widget"
              className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              Widgets
            </Link>
            <Link
              href="/changelog"
              className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              Log
            </Link>
            <Link
              href="/accuracy"
              className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              Accuracy
            </Link>
            <Link
              href="/debug"
              className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              Debug
            </Link>
            <Link
              href="/locations"
              className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              +
            </Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading && !currentWeather && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-pulse text-white/40 text-sm">Loading weather data...</div>
          </div>
        )}

        {currentWeather && (
          <WeatherPage weather={currentWeather} unit={unit} />
        )}

        {!loading && !currentWeather && (
          <div className="flex flex-col items-center justify-center py-20 text-white/40">
            <div className="text-4xl mb-4">☁️</div>
            <div className="text-lg">Nimbus Weather</div>
            <div className="text-sm mt-2">Select a location to view weather</div>
          </div>
        )}
      </div>
    </main>
  );
}
