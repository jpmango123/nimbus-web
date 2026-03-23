'use client';

// =============================================================================
// Widget Simulator Page — Shows all 3 widget sizes for fine-tuning
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { WeatherData, SavedLocation } from '@/lib/weather/types';
import SmallWidget from '@/components/widget/SmallWidget';
import MediumWidget from '@/components/widget/MediumWidget';
import LargeWidget from '@/components/widget/LargeWidget';
import Link from 'next/link';

const DEFAULT_LOCATIONS: SavedLocation[] = [
  { id: 1, name: 'Boston, MA', latitude: 42.3601, longitude: -71.0589, timezone: 'America/New_York', sortOrder: 0 },
];

export default function WidgetPage() {
  const [locations, setLocations] = useState<SavedLocation[]>(DEFAULT_LOCATIONS);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState<'F' | 'C'>('F');

  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setLocations(data); })
      .catch(() => {});
  }, []);

  const fetchWeather = useCallback(async (loc: SavedLocation) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: String(loc.latitude), lon: String(loc.longitude),
        name: loc.name, tz: loc.timezone,
      });
      const res = await fetch(`/api/weather?${params}`);
      const data = await res.json();
      if (data && !data.error) setWeather(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (locations[selectedIdx]) fetchWeather(locations[selectedIdx]);
  }, [selectedIdx, locations, fetchWeather]);

  return (
    <main className="min-h-screen">
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#0d1521]/80 border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/50 hover:text-white/80 text-sm">← Back</Link>
            <h1 className="text-lg font-semibold">Widget Simulator</h1>
          </div>
          <div className="flex items-center gap-2">
            {locations.map((loc, i) => (
              <button
                key={loc.id}
                onClick={() => setSelectedIdx(i)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  i === selectedIdx
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                {loc.name.split(',')[0]}
              </button>
            ))}
            <button
              onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
              className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80"
            >
              °{unit}
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {loading && !weather && (
          <div className="text-white/40 text-sm text-center py-20 animate-pulse">Loading...</div>
        )}

        {weather && (
          <div className="space-y-10">
            {/* Small Widget */}
            <section>
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">
                Small Widget (155×155pt)
              </h2>
              <div className="inline-block">
                <SmallWidget weather={weather} unit={unit} />
              </div>
            </section>

            {/* Medium Widget */}
            <section>
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">
                Medium Widget (329×155pt)
              </h2>
              <div className="inline-block">
                <MediumWidget weather={weather} unit={unit} />
              </div>
            </section>

            {/* Large Widget */}
            <section>
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">
                Large Widget (329×345pt)
              </h2>
              <div className="inline-block">
                <LargeWidget weather={weather} unit={unit} />
              </div>
            </section>

            {/* Notes */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-xs text-white/40 space-y-2">
              <p>These widgets render at the same logical pixel dimensions as iOS widgets.</p>
              <p>Use this page to fine-tune visual parameters — changes here inform adjustments to the iOS codebase.</p>
              <p>The AI audit system captures screenshots of these widgets nightly for comparison.</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
