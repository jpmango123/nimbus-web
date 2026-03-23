'use client';

import { StormEvent, STORM_SEVERITY_META, PRECIP_TYPE_META } from '@/lib/weather/types';

interface Props {
  storms: StormEvent[];
}

export default function StormBanner({ storms }: Props) {
  if (!storms.length) return null;

  return (
    <div className="space-y-2">
      {storms.map(storm => {
        const meta = STORM_SEVERITY_META[storm.severity];
        const precipMeta = PRECIP_TYPE_META[storm.dominantPrecipType];
        const start = new Date(storm.startTime);
        const end = new Date(storm.endTime);
        const durationHrs = Math.round((end.getTime() - start.getTime()) / 3600000);

        return (
          <div
            key={storm.id}
            className="rounded-xl border p-3"
            style={{
              borderColor: meta.color + '40',
              backgroundColor: meta.color + '10',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span>{precipMeta.icon}</span>
              <span className="font-medium text-sm" style={{ color: meta.color }}>
                {meta.displayName} {precipMeta.displayName} Storm
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-white/60">
              <div>
                <div className="text-white/40">Duration</div>
                <div>{durationHrs}h</div>
              </div>
              <div>
                <div className="text-white/40">Total</div>
                <div>{storm.totalAccumulation >= 1
                  ? `${storm.totalAccumulation.toFixed(1)}"`
                  : `${storm.totalAccumulation.toFixed(2)}"`}</div>
              </div>
              <div>
                <div className="text-white/40">Peak</div>
                <div>{storm.peakIntensity.toFixed(2)} in/hr</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
