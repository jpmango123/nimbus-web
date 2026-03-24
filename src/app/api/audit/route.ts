// =============================================================================
// GET /api/audit — Data collection cron (runs every 3 hours)
// Captures forecast snapshots, per-model breakdowns, and historical actuals
// =============================================================================

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchOpenMeteoWeather, fetchHistoricalWeather, fetchHourlyHistorical, fetchPerModelData } from '@/lib/weather/open-meteo';
import { LocationInfo } from '@/lib/weather/types';

export const maxDuration = 120; // Increased for hourly data storage

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

        // 4. Fetch actual weather for last 3 days (backfill to catch gaps)
        for (let dayBack = 1; dayBack <= 3; dayBack++) {
          const pastDate = new Date(now.getTime() - dayBack * 86400000);
          const pastDateStr = pastDate.toISOString().slice(0, 10);

          // Skip if we already have this date
          const existing = await sql`
            SELECT 1 FROM actual_weather
            WHERE location_id = ${loc.id} AND date = ${pastDateStr}
          `;
          if (existing.length > 0) continue;

          const actual = await fetchHistoricalWeather(
            location.latitude, location.longitude, pastDateStr
          );

          if (actual) {
            await sql`
              INSERT INTO actual_weather
                (location_id, date, actual_high, actual_low, actual_precip,
                 actual_precip_type, actual_condition, actual_wind_speed, source)
              VALUES
                (${loc.id}, ${pastDateStr}, ${actual.high}, ${actual.low},
                 ${actual.precipTotal}, ${actual.precipType}, ${actual.condition},
                 ${actual.windSpeedMax}, 'open-meteo-historical')
              ON CONFLICT (location_id, date) DO NOTHING
            `;
            if (dayBack === 1) {
              results.push(`  ↳ Actual for ${pastDateStr}: H${Math.round(actual.high)}° L${Math.round(actual.low)}° precip ${actual.precipTotal.toFixed(2)}" (${actual.precipType})`);
            }
          }
        }

        // 5. Store hourly forecast snapshots (next 48h)
        // This captures "what the graph looked like" at this point in time
        const hourlyToStore = weather.hourly.slice(0, 48);
        if (hourlyToStore.length > 0) {
          // Batch insert — store every 3rd hour to save space (16 rows per audit per location)
          for (let hi = 0; hi < hourlyToStore.length; hi += 3) {
            const h = hourlyToStore[hi];
            const targetHour = new Date(h.time).toISOString();
            const hrsAhead = Math.round(
              (new Date(h.time).getTime() - now.getTime()) / 3600000
            );
            await sql`
              INSERT INTO hourly_forecast_snapshots
                (location_id, captured_at, target_hour, hours_ahead,
                 predicted_temp, predicted_precip_prob, predicted_precip_accum,
                 predicted_precip_type, predicted_wind_speed, predicted_condition)
              VALUES
                (${loc.id}, ${now.toISOString()}, ${targetHour}, ${hrsAhead},
                 ${h.temperature}, ${h.precipProbability}, ${h.precipAccumulation},
                 ${h.precipType}, ${h.windSpeed}, ${h.condition})
            `;
          }
          results.push(`  ↳ Stored ${Math.ceil(hourlyToStore.length / 3)} hourly snapshots`);
        }

        // 6. Fetch hourly actuals for yesterday (for graph accuracy comparison)
        const yesterday = new Date(now.getTime() - 86400000);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        // Check if we already have hourly actuals for yesterday
        const existingHourly = await sql`
          SELECT 1 FROM hourly_actuals
          WHERE location_id = ${loc.id}
            AND hour >= ${yesterdayStr + 'T00:00:00Z'}
            AND hour < ${yesterdayStr + 'T23:59:59Z'}
          LIMIT 1
        `;

        if (existingHourly.length === 0) {
          const hourlyActuals = await fetchHourlyHistorical(
            location.latitude, location.longitude, yesterdayStr, yesterdayStr
          );

          if (hourlyActuals && hourlyActuals.length > 0) {
            for (const ha of hourlyActuals) {
              await sql`
                INSERT INTO hourly_actuals
                  (location_id, hour, actual_temp, actual_precip, actual_snowfall,
                   actual_wind_speed, weather_code, source)
                VALUES
                  (${loc.id}, ${ha.time}, ${ha.temperature}, ${ha.precipitation},
                   ${ha.snowfall}, ${ha.windSpeed}, ${ha.weatherCode},
                   'open-meteo-historical')
                ON CONFLICT (location_id, hour) DO NOTHING
              `;
            }
            results.push(`  ↳ Stored ${hourlyActuals.length} hourly actuals for ${yesterdayStr}`);
          }
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
