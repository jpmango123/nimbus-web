// =============================================================================
// GET /api/audit — Data collection cron (runs every 3 hours)
// Captures forecast snapshots, per-model breakdowns, and historical actuals
// =============================================================================

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchOpenMeteoWeather, fetchHistoricalWeather, fetchPerModelData } from '@/lib/weather/open-meteo';
import { LocationInfo } from '@/lib/weather/types';

export const maxDuration = 60;

export async function GET() {
  const results: string[] = [];

  try {
    const sql = getDb();

    const locations = await sql`SELECT * FROM locations ORDER BY sort_order ASC`;
    if (!locations.length) {
      return NextResponse.json({ message: 'No locations configured', results });
    }

    const now = new Date();

    for (const loc of locations) {
      const location: LocationInfo = {
        name: loc.name as string,
        latitude: loc.latitude as number,
        longitude: loc.longitude as number,
        timezone: (loc.timezone as string) || 'America/New_York',
      };

      try {
        // 1. Fetch blended forecast
        const weather = await fetchOpenMeteoWeather(location);

        // 2. Fetch per-model data for blending analysis
        let modelBreakdown = null;
        try {
          modelBreakdown = await fetchPerModelData(location.latitude, location.longitude);
        } catch {
          // Non-critical — continue without per-model data
        }

        // 3. Store forecast snapshots for today + next 3 days
        for (let dayOffset = 0; dayOffset < Math.min(4, weather.daily.length); dayOffset++) {
          const day = weather.daily[dayOffset];
          const targetDate = new Date(day.time).toISOString().slice(0, 10);
          const hoursAhead = Math.round(
            (new Date(day.time).getTime() - now.getTime()) / 3600000
          );

          // Include per-model data in raw_json for later analysis
          const rawData: Record<string, unknown> = {
            hourlySlice: weather.hourly.slice(dayOffset * 24, (dayOffset + 1) * 24),
            daily: day,
          };

          if (modelBreakdown) {
            rawData.perModel = {
              hrrr: modelBreakdown.hrrr?.[dayOffset] || null,
              nbm: modelBreakdown.nbm?.[dayOffset] || null,
              gfs: modelBreakdown.gfs?.[dayOffset] || null,
            };
          }

          await sql`
            INSERT INTO forecast_snapshots
              (location_id, captured_at, target_date, hours_ahead,
               predicted_high, predicted_low, predicted_precip_prob,
               predicted_precip_type, predicted_precip_accum, predicted_condition,
               raw_json)
            VALUES
              (${loc.id}, ${now.toISOString()}, ${targetDate}, ${hoursAhead},
               ${day.temperatureHigh}, ${day.temperatureLow}, ${day.precipProbability},
               ${day.precipType}, ${day.precipAccumulation}, ${day.conditionDay},
               ${JSON.stringify(rawData)})
          `;
        }

        const modelInfo = modelBreakdown ? ' (+ per-model data)' : '';
        results.push(`✓ ${location.name}: ${weather.daily.length} days captured${modelInfo}`);

        // 4. Fetch yesterday's actual weather
        const yesterday = new Date(now.getTime() - 86400000);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        const actual = await fetchHistoricalWeather(
          location.latitude, location.longitude, yesterdayStr
        );

        if (actual) {
          await sql`
            INSERT INTO actual_weather
              (location_id, date, actual_high, actual_low, actual_precip,
               actual_condition, source)
            VALUES
              (${loc.id}, ${yesterdayStr}, ${actual.high}, ${actual.low},
               ${actual.precipTotal}, ${actual.condition}, 'open-meteo-historical')
            ON CONFLICT (location_id, date) DO NOTHING
          `;
          results.push(`  ↳ Actual for ${yesterdayStr}: H${Math.round(actual.high)}° L${Math.round(actual.low)}° precip ${actual.precipTotal.toFixed(2)}"`);
        }

      } catch (err) {
        results.push(`✗ ${location.name}: ${err}`);
      }
    }

    return NextResponse.json({ success: true, timestamp: now.toISOString(), results });
  } catch (err) {
    console.error('[AUDIT] Error:', err);
    return NextResponse.json({ error: String(err), results }, { status: 500 });
  }
}
