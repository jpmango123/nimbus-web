'use client';

// =============================================================================
// Debug Page — Shows per-model API data side-by-side with blended output
// This is what Claude and you use to see how each API processes data
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { SavedLocation } from '@/lib/weather/types';
import { tempToColor } from '@/components/ui/TemperatureColor';
import Link from 'next/link';

interface ModelData {
  high: number;
  low: number;
  precipProb: number;
  precipAccum: number;
}

interface DayComparison {
  date: string;
  blended: ModelData & { precipType: string; condition: string };
  hrrr: ModelData | null;
  nbm: ModelData | null;
  gfs: ModelData | null;
}

interface HourlyEntry {
  time: string;
  temp: number;
  precipProb: number;
  precipIntensity: number;
  precipType: string;
  condition: string;
  windSpeed: number;
  confidenceLow: number | null;
  confidenceHigh: number | null;
}

interface DebugData {
  location: { name: string };
  provider: string;
  fetchedAt: string;
  alerts: number;
  blendingWeights: Record<string, Record<string, number> | string>;
  dailyComparison: DayComparison[];
  hourlyPreview: HourlyEntry[];
  minutelyAvailable: boolean;
  minutelyCount: number;
  totalHourly: number;
  totalDaily: number;
}

const DEFAULT_LOCATIONS: SavedLocation[] = [
  { id: 1, name: 'Boston, MA', latitude: 42.3601, longitude: -71.0589, timezone: 'America/New_York', sortOrder: 0 },
];

export default function DebugPage() {
  const [locations, setLocations] = useState<SavedLocation[]>(DEFAULT_LOCATIONS);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [data, setData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d) && d.length > 0) setLocations(d); })
      .catch(() => {});
  }, []);

  const fetchDebug = useCallback(async (loc: SavedLocation) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: String(loc.latitude), lon: String(loc.longitude),
        name: loc.name, tz: loc.timezone,
      });
      const res = await fetch(`/api/debug?${params}`);
      const d = await res.json();
      if (!d.error) setData(d);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (locations[selectedIdx]) fetchDebug(locations[selectedIdx]);
  }, [selectedIdx, locations, fetchDebug]);

  return (
    <main className="min-h-screen">
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[#0d1521]/80 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/50 hover:text-white/80 text-sm">← Back</Link>
            <h1 className="text-lg font-semibold">API Debug — Per-Model Comparison</h1>
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
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loading && <div className="text-white/40 text-sm animate-pulse py-20 text-center">Loading model data...</div>}

        {data && (
          <>
            {/* Meta info */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 grid grid-cols-4 gap-4 text-xs">
              <div><span className="text-white/40">Provider:</span> <span className="text-white/80">{data.provider}</span></div>
              <div><span className="text-white/40">Hourly:</span> <span className="text-white/80">{data.totalHourly}h</span></div>
              <div><span className="text-white/40">Daily:</span> <span className="text-white/80">{data.totalDaily} days</span></div>
              <div><span className="text-white/40">Minutely:</span> <span className="text-white/80">{data.minutelyCount} entries</span></div>
            </div>

            {/* Blending weights */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">Blending Weights</h2>
              <div className="grid grid-cols-5 gap-2 text-xs">
                {Object.entries(data.blendingWeights).filter(([k]) => k !== 'description').map(([horizon, weights]) => (
                  <div key={horizon} className="bg-white/5 rounded-lg p-2">
                    <div className="text-white/40 mb-1">{horizon}</div>
                    {typeof weights === 'object' && Object.entries(weights).map(([model, w]) => (
                      <div key={model} className="flex justify-between">
                        <span className="text-white/60">{model.toUpperCase()}</span>
                        <span className="text-white/80 tabular-nums">{((w as number) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Daily model comparison table */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 overflow-x-auto">
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">
                Daily Forecast — Model Comparison
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 border-b border-white/10">
                    <th className="py-2 px-2 text-left">Date</th>
                    <th className="py-2 px-2 text-center" colSpan={3}>HRRR</th>
                    <th className="py-2 px-2 text-center" colSpan={3}>NBM</th>
                    <th className="py-2 px-2 text-center" colSpan={3}>GFS</th>
                    <th className="py-2 px-2 text-center bg-blue-500/5" colSpan={4}>BLENDED</th>
                  </tr>
                  <tr className="text-white/30 border-b border-white/5">
                    <th></th>
                    <th className="px-1">H</th><th className="px-1">L</th><th className="px-1">Prcp</th>
                    <th className="px-1">H</th><th className="px-1">L</th><th className="px-1">Prcp</th>
                    <th className="px-1">H</th><th className="px-1">L</th><th className="px-1">Prcp</th>
                    <th className="px-1 bg-blue-500/5">H</th><th className="px-1 bg-blue-500/5">L</th>
                    <th className="px-1 bg-blue-500/5">Prcp</th><th className="px-1 bg-blue-500/5">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyComparison.map((day, i) => {
                    const date = new Date(day.date);
                    const isToday = new Date().toDateString() === date.toDateString();
                    const label = isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

                    return (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-2 px-2 text-white/70 font-medium">{label}</td>
                        {/* HRRR */}
                        <ModelCells model={day.hrrr} />
                        {/* NBM */}
                        <ModelCells model={day.nbm} />
                        {/* GFS */}
                        <ModelCells model={day.gfs} />
                        {/* Blended */}
                        <td className="px-1 text-center bg-blue-500/5 font-medium" style={{ color: tempToColor(day.blended.high) }}>
                          {Math.round(day.blended.high)}°
                        </td>
                        <td className="px-1 text-center bg-blue-500/5" style={{ color: tempToColor(day.blended.low) }}>
                          {Math.round(day.blended.low)}°
                        </td>
                        <td className="px-1 text-center bg-blue-500/5 text-blue-300">
                          {Math.round(day.blended.precipProb * 100)}%
                        </td>
                        <td className="px-1 text-center bg-blue-500/5 text-white/40">
                          {day.blended.precipType}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Hourly detail for next 24h */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 overflow-x-auto">
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">
                Hourly Blended Output — Next 24h
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 border-b border-white/10">
                    <th className="py-2 px-2 text-left">Time</th>
                    <th className="py-2 px-1">Temp</th>
                    <th className="py-2 px-1">Precip%</th>
                    <th className="py-2 px-1">Intensity</th>
                    <th className="py-2 px-1">Type</th>
                    <th className="py-2 px-1">Wind</th>
                    <th className="py-2 px-1">Condition</th>
                    <th className="py-2 px-1">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hourlyPreview.map((h, i) => {
                    const date = new Date(h.time);
                    const hasPrecip = h.precipProb > 0.1;
                    return (
                      <tr key={i} className={`border-b border-white/5 ${hasPrecip ? 'bg-blue-500/5' : ''}`}>
                        <td className="py-1 px-2 text-white/60">
                          {i === 0 ? 'Now' : date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })}
                        </td>
                        <td className="px-1 text-center tabular-nums" style={{ color: tempToColor(h.temp) }}>
                          {Math.round(h.temp)}°
                        </td>
                        <td className={`px-1 text-center tabular-nums ${hasPrecip ? 'text-blue-300 font-medium' : 'text-white/40'}`}>
                          {Math.round(h.precipProb * 100)}%
                        </td>
                        <td className="px-1 text-center tabular-nums text-white/40">
                          {h.precipIntensity > 0 ? h.precipIntensity.toFixed(3) : '—'}
                        </td>
                        <td className="px-1 text-center text-white/40">{h.precipType}</td>
                        <td className="px-1 text-center tabular-nums text-white/40">{Math.round(h.windSpeed)}</td>
                        <td className="px-1 text-center text-white/40">{h.condition}</td>
                        <td className="px-1 text-center tabular-nums text-white/30">
                          {h.confidenceLow != null && h.confidenceHigh != null
                            ? `${h.confidenceLow.toFixed(2)}–${h.confidenceHigh.toFixed(2)}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Display thresholds reference */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-3">Chart Display Thresholds</h2>
              <div className="grid grid-cols-2 gap-3 text-xs text-white/60">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-white/40 mb-1">App Charts</div>
                  <div>DailyWeatherChart: threshold=0.05, sigma=1.5</div>
                  <div>HourlyForecastCard: threshold=0.05, sigma=2.0</div>
                  <div>PrecipitationGraph: shows all values (no threshold)</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-white/40 mb-1">Widget Charts</div>
                  <div>Sparkline hourly: threshold=0.10</div>
                  <div>Medium/Large daily: threshold=0.08, sigma=3.0</div>
                  <div>Minutely: intensity threshold=0.01</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ModelCells({ model }: { model: { high: number; low: number; precipProb: number; precipAccum: number } | null }) {
  if (!model) {
    return (
      <>
        <td className="px-1 text-center text-white/20">—</td>
        <td className="px-1 text-center text-white/20">—</td>
        <td className="px-1 text-center text-white/20">—</td>
      </>
    );
  }
  return (
    <>
      <td className="px-1 text-center tabular-nums" style={{ color: tempToColor(model.high) }}>
        {Math.round(model.high)}°
      </td>
      <td className="px-1 text-center tabular-nums" style={{ color: tempToColor(model.low) }}>
        {Math.round(model.low)}°
      </td>
      <td className={`px-1 text-center tabular-nums ${model.precipProb > 0.1 ? 'text-blue-300' : 'text-white/40'}`}>
        {Math.round(model.precipProb * 100)}%
      </td>
    </>
  );
}
