'use client';

// =============================================================================
// Accuracy Dashboard — Tracks forecast vs actual weather performance
// Shows Brier skill score, hourly accuracy, and daily comparison
// =============================================================================

import { useState, useEffect } from 'react';

interface LocationSummary {
  location_name: string;
  location_id: number;
  avg_temp_error_high: number;
  avg_temp_error_low: number;
  avg_precip_error: number;
  days_compared: number;
}

interface BrierScore {
  location_name: string;
  location_id: number;
  brier_score: number;
  mae_precip: number;
  hours_compared: number;
}

interface DailyComparison {
  date: string;
  actual_high: number;
  actual_low: number;
  actual_precip: number;
  actual_precip_type: string | null;
  predicted_high: number;
  predicted_low: number;
  predicted_precip_prob: number;
  predicted_precip_accum: number;
  predicted_precip_type: string;
  hours_ahead: number;
}

interface HourlyComparison {
  target_hour: string;
  hours_ahead: number;
  predicted_temp: number;
  predicted_precip_prob: number;
  predicted_precip_accum: number;
  predicted_precip_type: string;
  actual_temp: number;
  actual_precip: number;
  actual_snowfall: number;
}

function brierGrade(score: number): { label: string; color: string } {
  if (score < 0.05) return { label: 'Excellent', color: '#22C55E' };
  if (score < 0.10) return { label: 'Good', color: '#84CC16' };
  if (score < 0.15) return { label: 'Fair', color: '#EAB308' };
  if (score < 0.25) return { label: 'Poor', color: '#F97316' };
  return { label: 'Worse than climatology', color: '#EF4444' };
}

export default function AccuracyPage() {
  const [summaries, setSummaries] = useState<LocationSummary[]>([]);
  const [brierScores, setBrierScores] = useState<BrierScore[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  const [dailyData, setDailyData] = useState<DailyComparison[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyComparison[]>([]);
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<'daily' | 'hourly'>('daily');

  useEffect(() => {
    fetch(`/api/historical?days=${days}`)
      .then(r => r.json())
      .then(setSummaries)
      .catch(() => {});
    fetch(`/api/historical?mode=brier&days=${days}`)
      .then(r => r.json())
      .then(setBrierScores)
      .catch(() => {});
  }, [days]);

  useEffect(() => {
    if (!selectedLocation) return;
    fetch(`/api/historical?locationId=${selectedLocation}&days=${days}`)
      .then(r => r.json())
      .then(setDailyData)
      .catch(() => {});
    fetch(`/api/historical?mode=hourly&locationId=${selectedLocation}&days=${days}`)
      .then(r => r.json())
      .then(setHourlyData)
      .catch(() => {});
  }, [selectedLocation, days]);

  return (
    <main className="min-h-screen bg-[#0d1521] text-white p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Forecast Accuracy</h1>
        <div className="flex gap-2">
          {[3, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-lg text-xs ${days === d ? 'bg-blue-500/30 text-blue-300' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
            >
              {d}d
            </button>
          ))}
          <a href="/" className="px-3 py-1 rounded-lg text-xs bg-white/5 text-white/50 hover:bg-white/10">Dashboard</a>
        </div>
      </div>

      {/* Brier Skill Score */}
      {brierScores.length > 0 && (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">Precipitation Skill (Brier Score)</h2>
          <div className="text-xs text-white/40 mb-3">
            0.00 = perfect | &lt;0.10 = good | &lt;0.25 = usable | &gt;0.25 = worse than guessing
          </div>
          <div className="grid gap-2">
            {brierScores.map(b => {
              const grade = brierGrade(b.brier_score);
              return (
                <div key={b.location_id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                  <span className="text-sm">{b.location_name}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-white/50">{b.hours_compared} hours</span>
                    <span style={{ color: grade.color }} className="font-medium">
                      {b.brier_score?.toFixed(4)} ({grade.label})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Location Summaries */}
      <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">Daily Accuracy by Location</h2>
        {summaries.length === 0 ? (
          <p className="text-white/40 text-sm">No accuracy data yet. Audits need to run for a few days.</p>
        ) : (
          <div className="grid gap-2">
            {summaries.map(s => (
              <button
                key={s.location_id}
                onClick={() => setSelectedLocation(s.location_id)}
                className={`flex items-center justify-between p-3 rounded-lg text-left transition ${
                  selectedLocation === s.location_id ? 'bg-blue-500/20 border border-blue-500/30' : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div>
                  <div className="text-sm font-medium">{s.location_name}</div>
                  <div className="text-xs text-white/40">{s.days_compared} days compared</div>
                </div>
                <div className="flex gap-4 text-xs tabular-nums">
                  <div className="text-right">
                    <div className="text-white/40">Temp Error</div>
                    <div className={s.avg_temp_error_high < 3 ? 'text-green-400' : s.avg_temp_error_high < 5 ? 'text-yellow-400' : 'text-red-400'}>
                      H: {s.avg_temp_error_high?.toFixed(1)}° L: {s.avg_temp_error_low?.toFixed(1)}°
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white/40">Precip Error</div>
                    <div className={s.avg_precip_error < 0.1 ? 'text-green-400' : s.avg_precip_error < 0.3 ? 'text-yellow-400' : 'text-red-400'}>
                      {s.avg_precip_error?.toFixed(2)}&quot;
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail view for selected location */}
      {selectedLocation && (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setTab('daily')}
              className={`px-3 py-1 rounded-lg text-xs ${tab === 'daily' ? 'bg-blue-500/30 text-blue-300' : 'bg-white/5 text-white/50'}`}
            >
              Daily ({dailyData.length})
            </button>
            <button
              onClick={() => setTab('hourly')}
              className={`px-3 py-1 rounded-lg text-xs ${tab === 'hourly' ? 'bg-blue-500/30 text-blue-300' : 'bg-white/5 text-white/50'}`}
            >
              Hourly ({hourlyData.length})
            </button>
          </div>

          {tab === 'daily' && dailyData.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 border-b border-white/10">
                    <th className="text-left p-2">Date</th>
                    <th className="text-right p-2">Pred H/L</th>
                    <th className="text-right p-2">Act H/L</th>
                    <th className="text-right p-2">Temp Err</th>
                    <th className="text-right p-2">Pred Precip</th>
                    <th className="text-right p-2">Act Precip</th>
                    <th className="text-right p-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyData.map((d, i) => {
                    const highErr = Math.abs(d.predicted_high - d.actual_high);
                    const lowErr = Math.abs(d.predicted_low - d.actual_low);
                    const precipErr = Math.abs(d.predicted_precip_accum - d.actual_precip);
                    return (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                        <td className="p-2 text-white/70">{d.date}</td>
                        <td className="p-2 text-right">{Math.round(d.predicted_high)}°/{Math.round(d.predicted_low)}°</td>
                        <td className="p-2 text-right font-medium">{Math.round(d.actual_high)}°/{Math.round(d.actual_low)}°</td>
                        <td className={`p-2 text-right ${highErr > 5 ? 'text-red-400' : highErr > 3 ? 'text-yellow-400' : 'text-green-400'}`}>
                          {highErr.toFixed(1)}°/{lowErr.toFixed(1)}°
                        </td>
                        <td className="p-2 text-right">{Math.round(d.predicted_precip_prob * 100)}% / {d.predicted_precip_accum?.toFixed(2)}&quot;</td>
                        <td className={`p-2 text-right font-medium ${precipErr > 0.3 ? 'text-red-400' : 'text-white/70'}`}>
                          {d.actual_precip?.toFixed(2)}&quot;
                        </td>
                        <td className="p-2 text-right">
                          <span className="text-white/40">{d.predicted_precip_type}</span>
                          {d.actual_precip_type && d.actual_precip_type !== d.predicted_precip_type && (
                            <span className="text-red-400 ml-1">({d.actual_precip_type})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'hourly' && hourlyData.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 border-b border-white/10">
                    <th className="text-left p-2">Hour</th>
                    <th className="text-right p-2">Lead</th>
                    <th className="text-right p-2">Pred Temp</th>
                    <th className="text-right p-2">Act Temp</th>
                    <th className="text-right p-2">Err</th>
                    <th className="text-right p-2">Pred Precip %</th>
                    <th className="text-right p-2">Act Precip</th>
                  </tr>
                </thead>
                <tbody>
                  {hourlyData.map((h, i) => {
                    const tempErr = Math.abs(h.predicted_temp - h.actual_temp);
                    const didRain = h.actual_precip > 0.005;
                    const predictedRain = h.predicted_precip_prob > 0.3;
                    const precipClass = (predictedRain && didRain) ? 'text-green-400'
                      : (!predictedRain && !didRain) ? 'text-white/40'
                      : 'text-red-400'; // miss or false alarm
                    return (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                        <td className="p-2 text-white/70">{new Date(h.target_hour).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}</td>
                        <td className="p-2 text-right text-white/40">{h.hours_ahead}h</td>
                        <td className="p-2 text-right">{Math.round(h.predicted_temp)}°</td>
                        <td className="p-2 text-right font-medium">{Math.round(h.actual_temp)}°</td>
                        <td className={`p-2 text-right ${tempErr > 5 ? 'text-red-400' : tempErr > 3 ? 'text-yellow-400' : 'text-green-400'}`}>
                          {tempErr.toFixed(1)}°
                        </td>
                        <td className={`p-2 text-right ${precipClass}`}>
                          {Math.round(h.predicted_precip_prob * 100)}%
                        </td>
                        <td className={`p-2 text-right font-medium ${didRain ? 'text-blue-400' : 'text-white/30'}`}>
                          {h.actual_precip?.toFixed(3)}&quot;
                          {h.actual_snowfall > 0.01 && <span className="text-cyan-300 ml-1">({h.actual_snowfall.toFixed(2)}&quot; snow)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'hourly' && hourlyData.length === 0 && (
            <p className="text-white/40 text-sm">No hourly comparison data yet. Hourly actuals need at least 1 day of audit history.</p>
          )}
          {tab === 'daily' && dailyData.length === 0 && (
            <p className="text-white/40 text-sm">No daily comparison data yet for this location.</p>
          )}
        </div>
      )}
    </main>
  );
}
