'use client';

import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { TideData } from '@/lib/weather/types';

interface Props {
  tideData: TideData;
}

export default function TideCard({ tideData }: Props) {
  if (!tideData.entries.length) return null;

  const now = Date.now();
  // Show entries within +/- 12 hours of now
  const visible = tideData.entries.filter(e => {
    const t = new Date(e.time).getTime();
    return t > now - 6 * 3600000 && t < now + 18 * 3600000;
  });

  if (visible.length < 3) return null;

  const data = visible.map(e => {
    const date = new Date(e.time);
    const hoursFromNow = (date.getTime() - now) / 3600000;
    let label = '';
    if (Math.abs(hoursFromNow) < 0.5) label = 'Now';
    else if (hoursFromNow > 0 && Math.abs(hoursFromNow % 3) < 0.5) {
      label = date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    }
    return { label, height: e.height, time: e.time };
  });

  // Upcoming high/low tides
  const upcoming = tideData.highLow
    .filter(e => new Date(e.time).getTime() > now)
    .slice(0, 4);

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4">
      <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-wider mb-3 px-2">
        <span>🌊</span>
        <span>Tides — {tideData.station}</span>
      </div>

      <div className="h-[80px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
            <defs>
              <linearGradient id="tideGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#06B6D4" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis hide />
            <Area
              type="natural"
              dataKey="height"
              stroke="#06B6D4"
              strokeWidth={1.5}
              fill="url(#tideGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Upcoming high/low */}
      {upcoming.length > 0 && (
        <div className="flex gap-3 mt-2 overflow-x-auto">
          {upcoming.map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-white/50 whitespace-nowrap">
              <span className={e.type === 'H' ? 'text-cyan-300' : 'text-blue-300'}>
                {e.type === 'H' ? '▲' : '▼'}
              </span>
              <span>{e.height.toFixed(1)} ft</span>
              <span className="text-white/30">
                {new Date(e.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
