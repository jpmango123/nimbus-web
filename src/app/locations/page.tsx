'use client';

import { useState, useEffect } from 'react';
import { SavedLocation } from '@/lib/weather/types';
import Link from 'next/link';

export default function LocationsPage() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [tz, setTz] = useState('America/New_York');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setLocations(data);
      })
      .catch(() => {});
  }, []);

  const addLocation = async () => {
    if (!name || !lat || !lon) {
      setMessage('Name, latitude, and longitude are required');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          latitude: parseFloat(lat),
          longitude: parseFloat(lon),
          timezone: tz,
        }),
      });
      if (res.ok) {
        const loc = await res.json();
        setLocations(prev => [...prev, loc]);
        setName(''); setLat(''); setLon('');
        setMessage('Location added!');
      } else {
        setMessage('Failed to add location. Is the database configured?');
      }
    } catch {
      setMessage('Failed to connect. Set up DATABASE_URL in Vercel.');
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

  const presets = [
    { name: 'Boston, MA', lat: 42.3601, lon: -71.0589, tz: 'America/New_York' },
    { name: 'New York, NY', lat: 40.7128, lon: -74.0060, tz: 'America/New_York' },
    { name: 'Chicago, IL', lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
    { name: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
    { name: 'Miami, FL', lat: 25.7617, lon: -80.1918, tz: 'America/New_York' },
    { name: 'Denver, CO', lat: 39.7392, lon: -104.9903, tz: 'America/Denver' },
    { name: 'Seattle, WA', lat: 47.6062, lon: -122.3321, tz: 'America/Los_Angeles' },
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
        {/* Current locations */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">Saved Locations</h2>
          {locations.length === 0 && (
            <div className="text-white/30 text-sm py-4 text-center">
              No saved locations. Add one below or use a preset.
            </div>
          )}
          {locations.map(loc => (
            <div key={loc.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
              <div>
                <div className="text-sm text-white/80">{loc.name}</div>
                <div className="text-xs text-white/30">{loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}</div>
              </div>
              <button
                onClick={() => deleteLocation(loc.id)}
                className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Quick presets */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">Quick Add</h2>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button
                key={p.name}
                onClick={() => { setName(p.name); setLat(String(p.lat)); setLon(String(p.lon)); setTz(p.tz); }}
                className="px-3 py-1.5 rounded-full text-xs bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80 border border-white/10 transition-all"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Add form */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
          <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider">Add Location</h2>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="City name (e.g. Boston, MA)"
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={lat}
              onChange={e => setLat(e.target.value)}
              placeholder="Latitude"
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              value={lon}
              onChange={e => setLon(e.target.value)}
              placeholder="Longitude"
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <select
            value={tz}
            onChange={e => setTz(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50"
          >
            <option value="America/New_York">Eastern</option>
            <option value="America/Chicago">Central</option>
            <option value="America/Denver">Mountain</option>
            <option value="America/Los_Angeles">Pacific</option>
            <option value="Pacific/Honolulu">Hawaii</option>
            <option value="America/Anchorage">Alaska</option>
          </select>
          <button
            onClick={addLocation}
            disabled={saving}
            className="w-full py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 text-sm font-medium hover:bg-blue-500/30 transition-all disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Add Location'}
          </button>
          {message && (
            <div className="text-xs text-white/50 text-center">{message}</div>
          )}
        </div>
      </div>
    </main>
  );
}
