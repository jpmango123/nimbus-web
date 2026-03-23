'use client';

import { useState, useEffect, useRef } from 'react';
import { SavedLocation } from '@/lib/weather/types';
import Link from 'next/link';

interface SearchResult {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  fullAddress: string;
}

export default function LocationsPage() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setLocations(data); })
      .catch(() => {});
  }, []);

  // Debounced search as user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (Array.isArray(data)) setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const addLocation = async (result: SearchResult) => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: result.name,
          latitude: result.latitude,
          longitude: result.longitude,
          timezone: result.timezone,
        }),
      });
      if (res.ok) {
        const loc = await res.json();
        setLocations(prev => [...prev, loc]);
        setQuery('');
        setResults([]);
        setMessage(`Added ${result.name}!`);
      } else {
        setMessage('Failed to add. Is the database configured?');
      }
    } catch {
      setMessage('Failed to connect.');
    } finally {
      setSaving(false);
    }
  };

  const deleteLocation = async (id: number) => {
    try {
      await fetch(`/api/locations?id=${id}`, { method: 'DELETE' });
      setLocations(prev => prev.filter(l => l.id !== id));
    } catch {
      setMessage('Failed to delete');
    }
  };

  const presets: SearchResult[] = [
    { name: 'Boston, MA', latitude: 42.3601, longitude: -71.0589, timezone: 'America/New_York', fullAddress: '' },
    { name: 'New York, NY', latitude: 40.7128, longitude: -74.0060, timezone: 'America/New_York', fullAddress: '' },
    { name: 'Chicago, IL', latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago', fullAddress: '' },
    { name: 'Los Angeles, CA', latitude: 34.0522, longitude: -118.2437, timezone: 'America/Los_Angeles', fullAddress: '' },
    { name: 'Miami, FL', latitude: 25.7617, longitude: -80.1918, timezone: 'America/New_York', fullAddress: '' },
    { name: 'Denver, CO', latitude: 39.7392, longitude: -104.9903, timezone: 'America/Denver', fullAddress: '' },
    { name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321, timezone: 'America/Los_Angeles', fullAddress: '' },
  ];

  return (
    <main className="min-h-screen">
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#0d1521]/80 border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-white/50 hover:text-white/80 text-sm">← Back</Link>
          <h1 className="text-lg font-semibold">Manage Locations</h1>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Search */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">Add a City</h2>
          <div className="relative">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for a city, state, or address..."
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 transition-colors"
              autoFocus
            />
            {searching && (
              <div className="absolute right-3 top-3.5 text-white/30 text-xs animate-pulse">Searching...</div>
            )}
          </div>

          {/* Search results */}
          {results.length > 0 && (
            <div className="mt-2 space-y-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => addLocation(r)}
                  disabled={saving}
                  className="w-full text-left px-4 py-3 rounded-xl bg-white/5 hover:bg-blue-500/10 border border-white/5 hover:border-blue-500/20 transition-all disabled:opacity-50"
                >
                  <div className="text-sm text-white/90 font-medium">{r.name}</div>
                  <div className="text-xs text-white/40 mt-0.5">{r.fullAddress}</div>
                </button>
              ))}
            </div>
          )}

          {query.length >= 2 && !searching && results.length === 0 && (
            <div className="mt-2 text-xs text-white/30 text-center py-3">No results found</div>
          )}

          {message && (
            <div className="mt-2 text-xs text-blue-300 text-center">{message}</div>
          )}
        </div>

        {/* Quick presets */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">Quick Add</h2>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button
                key={p.name}
                onClick={() => addLocation(p)}
                disabled={saving}
                className="px-3 py-1.5 rounded-full text-xs bg-white/5 text-white/60 hover:bg-blue-500/10 hover:text-blue-300 border border-white/10 hover:border-blue-500/20 transition-all disabled:opacity-50"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Saved locations */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">
            Saved Locations ({locations.length})
          </h2>
          {locations.length === 0 && (
            <div className="text-white/30 text-sm py-4 text-center">
              No saved locations yet. Search above or use a quick preset.
            </div>
          )}
          {locations.map(loc => (
            <div key={loc.id} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
              <div>
                <div className="text-sm text-white/80 font-medium">{loc.name}</div>
                <div className="text-xs text-white/30 tabular-nums">
                  {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)} · {loc.timezone.split('/')[1]?.replace('_', ' ')}
                </div>
              </div>
              <button
                onClick={() => deleteLocation(loc.id)}
                className="text-xs text-red-400/50 hover:text-red-400 transition-colors px-2 py-1"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
