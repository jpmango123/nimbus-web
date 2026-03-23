'use client';

import { useState } from 'react';
import { WeatherAlert, ALERT_SEVERITY_META } from '@/lib/weather/types';

interface Props {
  alerts: WeatherAlert[];
}

export default function AlertBanner({ alerts }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const active = alerts.filter(a => {
    if (!a.endTime) return true;
    return new Date(a.endTime) > new Date();
  });

  if (!active.length) return null;

  return (
    <div className="space-y-2">
      {active.map(alert => {
        const meta = ALERT_SEVERITY_META[alert.severity];
        const isExpanded = expanded === alert.id;

        return (
          <div
            key={alert.id}
            className="rounded-xl border p-3 cursor-pointer transition-all"
            style={{
              borderColor: meta.color + '40',
              backgroundColor: meta.color + '10',
            }}
            onClick={() => setExpanded(isExpanded ? null : alert.id)}
          >
            <div className="flex items-center gap-2">
              <span>{meta.icon}</span>
              <span className="font-medium text-sm" style={{ color: meta.color }}>
                {alert.event}
              </span>
              <span className="ml-auto text-white/30 text-xs">
                {isExpanded ? '▼' : '▶'}
              </span>
            </div>
            {alert.headline && (
              <div className="text-xs text-white/60 mt-1">{alert.headline}</div>
            )}
            {isExpanded && (
              <div className="mt-2 text-xs text-white/50 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {alert.description}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
