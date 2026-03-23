// =============================================================================
// NWS (National Weather Service) API Client — Free, no API key
// Used for weather alerts (US only)
// =============================================================================

import { WeatherAlert, AlertSeverity } from './types';

const BASE_URL = 'https://api.weather.gov';
const USER_AGENT = 'Nimbus Weather Web App (nimbus-web, contact@nimbus.app)';

interface NWSAlertFeature {
  properties: {
    id: string;
    event: string;
    headline: string | null;
    description: string;
    severity: string;
    urgency: string;
    senderName: string;
    onset: string | null;
    expires: string | null;
    areaDesc: string;
  };
}

interface NWSAlertsResponse {
  features: NWSAlertFeature[];
}

function mapSeverity(sev: string | null): AlertSeverity {
  switch (sev?.toLowerCase()) {
    case 'extreme': return 'extreme';
    case 'severe': return 'severe';
    case 'moderate': return 'moderate';
    case 'minor': return 'minor';
    default: return 'unknown';
  }
}

export async function fetchNWSAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  const url = `${BASE_URL}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      next: { revalidate: 300 }, // 5 min cache
    });

    if (!res.ok) return [];
    const data: NWSAlertsResponse = await res.json();

    return data.features.map(f => {
      const p = f.properties;
      return {
        id: p.id,
        event: p.event,
        headline: p.headline,
        description: p.description,
        severity: mapSeverity(p.severity),
        urgency: p.urgency || null,
        sender: p.senderName || null,
        startTime: p.onset,
        endTime: p.expires,
        regions: p.areaDesc ? p.areaDesc.split('; ') : [],
      };
    });
  } catch {
    return [];
  }
}
