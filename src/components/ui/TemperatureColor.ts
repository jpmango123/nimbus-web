// =============================================================================
// Temperature → Color mapping — matches iOS widgetColorForTemperature()
// =============================================================================

/** Maps temperature (°F) to hsl() string.
 *  32°F → Blue (hue 216), 55°F → Green (119), 75°F → Yellow (54), 95°F → Red (0) */
export function tempToHue(tempF: number): number {
  if (tempF <= 32) return 216;
  if (tempF <= 55) return 216 - (216 - 119) * ((tempF - 32) / (55 - 32));
  if (tempF <= 75) return 119 - (119 - 54) * ((tempF - 55) / (75 - 55));
  if (tempF <= 95) return 54 - 54 * ((tempF - 75) / (95 - 75));
  return 0;
}

export function tempToColor(tempF: number, alpha = 1): string {
  const hue = Math.round(tempToHue(tempF));
  if (alpha < 1) return `hsla(${hue}, 85%, 60%, ${alpha})`;
  return `hsl(${hue}, 85%, 60%)`;
}

/** Precipitation type → CSS color */
export function precipTypeColor(type: string): string {
  switch (type) {
    case 'rain': return '#3B82F6';
    case 'snow': return '#E0F2FE';
    case 'sleet': return '#A855F7';
    default: return '#3B82F6';
  }
}

/** Alert severity → CSS color */
export function alertSeverityColor(severity: string): string {
  switch (severity) {
    case 'extreme': return '#EF4444';
    case 'severe': return '#F97316';
    case 'moderate': return '#EAB308';
    case 'minor': return '#3B82F6';
    default: return '#6B7280';
  }
}

/** Storm severity → CSS color */
export function stormSeverityColor(severity: string): string {
  switch (severity) {
    case 'minor': return '#22C55E';
    case 'moderate': return '#EAB308';
    case 'significant': return '#F97316';
    case 'severe': return '#EF4444';
    default: return '#6B7280';
  }
}
