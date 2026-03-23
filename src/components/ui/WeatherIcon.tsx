// =============================================================================
// Weather Icon Component — Maps WeatherCondition to emoji/SVG
// =============================================================================

import { WeatherCondition, CONDITION_META } from '@/lib/weather/types';

interface Props {
  condition: WeatherCondition;
  size?: number;
  className?: string;
}

export default function WeatherIcon({ condition, size = 32, className = '' }: Props) {
  const meta = CONDITION_META[condition] || CONDITION_META['unknown'];

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{ fontSize: size, lineHeight: 1 }}
      role="img"
      aria-label={meta.displayName}
    >
      {meta.icon}
    </span>
  );
}
