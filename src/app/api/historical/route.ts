// =============================================================================
// GET /api/historical — Query forecast vs actual comparison data
// Supports daily and hourly accuracy views
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const locationId = searchParams.get('locationId');
  const days = parseInt(searchParams.get('days') || '7');
  const mode = searchParams.get('mode') || 'daily'; // 'daily' | 'hourly' | 'summary' | 'brier'

  try {
    const sql = getDb();
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    if (mode === 'hourly' && locationId) {
      // Hourly forecast vs actual comparison
      const rows = await sql`
        WITH best_hourly AS (
          SELECT DISTINCT ON (location_id, target_hour)
            location_id, target_hour, hours_ahead, captured_at,
            predicted_temp, predicted_precip_prob, predicted_precip_accum,
            predicted_precip_type, predicted_wind_speed, predicted_condition
          FROM hourly_forecast_snapshots
          WHERE location_id = ${parseInt(locationId)}
            AND hours_ahead BETWEEN 6 AND 30
          ORDER BY location_id, target_hour, ABS(hours_ahead - 24) ASC
        )
        SELECT
          bh.target_hour,
          bh.hours_ahead,
          bh.predicted_temp,
          bh.predicted_precip_prob,
          bh.predicted_precip_accum,
          bh.predicted_precip_type,
          bh.predicted_condition,
          ha.actual_temp,
          ha.actual_precip,
          ha.actual_snowfall,
          ha.actual_wind_speed,
          ha.weather_code
        FROM best_hourly bh
        JOIN hourly_actuals ha ON ha.location_id = bh.location_id AND ha.hour = bh.target_hour
        WHERE bh.target_hour >= ${since + 'T00:00:00Z'}
        ORDER BY bh.target_hour DESC
        LIMIT 200
      `;
      return NextResponse.json(rows);
    }

    if (mode === 'brier') {
      // Brier skill score by location
      const rows = await sql`
        WITH best_hourly AS (
          SELECT DISTINCT ON (location_id, target_hour)
            location_id, target_hour, predicted_precip_prob
          FROM hourly_forecast_snapshots
          WHERE hours_ahead BETWEEN 6 AND 30
          ORDER BY location_id, target_hour, ABS(hours_ahead - 24) ASC
        )
        SELECT
          l.name as location_name,
          l.id as location_id,
          AVG(POWER(bh.predicted_precip_prob - CASE WHEN ha.actual_precip > 0.005 THEN 1 ELSE 0 END, 2)) as brier_score,
          AVG(ABS(bh.predicted_precip_prob - CASE WHEN ha.actual_precip > 0.005 THEN 1 ELSE 0 END)) as mae_precip,
          COUNT(*) as hours_compared
        FROM best_hourly bh
        JOIN hourly_actuals ha ON ha.location_id = bh.location_id AND ha.hour = bh.target_hour
        JOIN locations l ON l.id = bh.location_id
        WHERE bh.target_hour >= ${since + 'T00:00:00Z'}
        GROUP BY l.id, l.name
        ORDER BY l.sort_order
      `;
      return NextResponse.json(rows);
    }

    if (locationId) {
      // Daily forecast vs actual for a specific location (deduplicated)
      const rows = await sql`
        WITH best_snapshot AS (
          SELECT DISTINCT ON (location_id, target_date)
            location_id, target_date, predicted_high, predicted_low,
            predicted_precip_prob, predicted_precip_accum, predicted_precip_type,
            predicted_condition, hours_ahead
          FROM forecast_snapshots
          WHERE location_id = ${parseInt(locationId)}
            AND hours_ahead BETWEEN 12 AND 36
          ORDER BY location_id, target_date, ABS(hours_ahead - 24) ASC
        )
        SELECT
          aw.date,
          aw.actual_high, aw.actual_low, aw.actual_precip,
          aw.actual_precip_type, aw.actual_condition, aw.actual_wind_speed,
          bs.predicted_high, bs.predicted_low, bs.predicted_precip_prob,
          bs.predicted_precip_accum, bs.predicted_precip_type,
          bs.predicted_condition, bs.hours_ahead
        FROM actual_weather aw
        JOIN best_snapshot bs ON bs.location_id = aw.location_id AND bs.target_date = aw.date
        WHERE aw.location_id = ${parseInt(locationId)}
          AND aw.date >= ${since}
        ORDER BY aw.date DESC
      `;
      return NextResponse.json(rows);
    }

    // All locations summary (deduplicated)
    const rows = await sql`
      WITH best_snapshot AS (
        SELECT DISTINCT ON (location_id, target_date)
          location_id, target_date, predicted_high, predicted_low,
          predicted_precip_accum, hours_ahead
        FROM forecast_snapshots
        WHERE hours_ahead BETWEEN 12 AND 36
        ORDER BY location_id, target_date, ABS(hours_ahead - 24) ASC
      )
      SELECT
        l.name as location_name,
        l.id as location_id,
        AVG(ABS(bs.predicted_high - aw.actual_high)) as avg_temp_error_high,
        AVG(ABS(bs.predicted_low - aw.actual_low)) as avg_temp_error_low,
        AVG(ABS(bs.predicted_precip_accum - aw.actual_precip)) as avg_precip_error,
        COUNT(DISTINCT aw.date) as days_compared
      FROM locations l
      JOIN actual_weather aw ON aw.location_id = l.id AND aw.date >= ${since}
      JOIN best_snapshot bs ON bs.location_id = l.id AND bs.target_date = aw.date
      GROUP BY l.id, l.name
      ORDER BY l.sort_order
    `;

    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
